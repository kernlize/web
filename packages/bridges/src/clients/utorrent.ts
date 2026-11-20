import { afterSending, basicAuthorization, clientError, jsonList, jsonNumber, jsonRecord, jsonText, readClientJson, readClientText, requestClient } from './http';
import { magnetInfoHash, readTorrentMetainfo } from './torrent-metainfo';
import type {
  ClientOptions,
  ClientProbe,
  TorrentClient,
  TorrentClientFile,
  TorrentClientJob,
  TorrentClientLimits,
  TorrentClientSource,
  TorrentClientState,
} from './types';

type Json = Record<string, unknown>;
type Row = readonly unknown[];

/** What the WebUI wants back on every request: the token from `token.html` and the `GUID` cookie that came with it. */
interface Session {
  readonly token: string;
  readonly cookie: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_MS = 150;
/** Keeps a `getprops` address for a long list well under what an embedded web server accepts. */
const PROPS_PER_REQUEST = 40;
const PER_MILLE = 1000;

/** The status bits of a torrent row, as the WebUI API documents them. */
const STARTED = 1;
const CHECKING = 2;
const CHECKED = 8;
const ERRORED = 16;
const PAUSED = 32;
const QUEUED = 64;

/** Positions in a torrent row, as the WebUI API documents them. */
const HASH = 0;
const STATUS = 1;
const NAME = 2;
const SIZE = 3;
const PROGRESS = 4;
const DOWNLOADED = 5;
const UPLOADED = 6;
const UPLOAD_RATE = 8;
const DOWNLOAD_RATE = 9;
const ETA = 10;
const PEERS_CONNECTED = 12;
const PEERS_IN_SWARM = 13;
const SEEDS_CONNECTED = 14;
const SEEDS_IN_SWARM = 15;
/** Not in the published row format: uTorrent 3.x appends its own status line here ("Stopped", "Connecting to peers"), which is the only wording an error comes with. */
const STATUS_MESSAGE = 21;
const UNEXPLAINED_ERROR = 'uTorrent reports an error for this torrent';

/** File priorities as `getfiles` and `setprio` number them: 0 skips the file, 1 to 3 are low, normal, high. */
const SKIP = 0;
const NORMAL = 2;

function has(status: number, bit: number): boolean {
  return Math.floor(status / bit) % 2 === 1;
}

function checkedHash(infoHash: string): string {
  if (!/^[0-9a-f]{40}$/.test(infoHash)) throw clientError('invalid:info-hash');
  return infoHash;
}

function reportedHash(value: unknown): string {
  const hash = jsonText(value).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) throw clientError('unavailable:bad-response', 'the answer named no info hash');
  return hash;
}

function hashQuery(infoHash: string): string {
  return `hash=${infoHash.toUpperCase()}`;
}

/**
 * A torrent is only called complete or seeding when uTorrent is not checking it and
 * reports no error: the progress figure alone says nothing while either is true.
 * A magnet link whose metadata has not arrived shows as a started torrent of size 0.
 */
function stateOf(status: number, size: number, done: boolean): TorrentClientState {
  if (has(status, ERRORED)) return 'error';
  if (has(status, CHECKING)) return 'queued';
  if (has(status, PAUSED)) return 'paused';
  if (has(status, STARTED) && size === 0) return 'metadata';
  if (has(status, STARTED)) return done ? 'seeding' : 'downloading';
  if (done && has(status, CHECKED)) return 'complete';
  return has(status, QUEUED) ? 'queued' : 'paused';
}

/** `dht` and `pex` read -1, "not allowed", exactly when the torrent is private. */
function limitsOf(props: Json | undefined): Pick<TorrentClientJob, 'downloadLimit' | 'uploadLimit' | 'private'> {
  if (props === undefined) return { downloadLimit: 0, uploadLimit: 0 };
  return { downloadLimit: jsonNumber(props.dlrate), uploadLimit: jsonNumber(props.ulrate), private: props.dht === -1 || props.pex === -1 };
}

function jobOf(row: Row, props: Json | undefined): TorrentClientJob {
  const size = jsonNumber(row[SIZE]);
  const progress = jsonNumber(row[PROGRESS]) / PER_MILLE;
  const state = stateOf(jsonNumber(row[STATUS]), size, progress === 1);
  const eta = jsonNumber(row[ETA]);
  const message = row[STATUS_MESSAGE];
  return {
    infoHash: reportedHash(row[HASH]),
    name: jsonText(row[NAME]),
    state,
    downloadedBytes: jsonNumber(row[DOWNLOADED]),
    uploadedBytes: jsonNumber(row[UPLOADED]),
    ...(size > 0 ? { totalBytes: size, progress } : {}),
    downloadRate: jsonNumber(row[DOWNLOAD_RATE]),
    uploadRate: jsonNumber(row[UPLOAD_RATE]),
    // uTorrent counts connected seeds apart from connected peers.
    peers: jsonNumber(row[PEERS_CONNECTED]) + jsonNumber(row[SEEDS_CONNECTED]),
    seeds: jsonNumber(row[SEEDS_IN_SWARM]),
    leeches: jsonNumber(row[PEERS_IN_SWARM]),
    ...(eta > 0 ? { etaSeconds: eta } : {}),
    ...limitsOf(props),
    ...(state === 'error' ? { error: typeof message === 'string' ? message : UNEXPLAINED_ERROR } : {}),
  };
}

function fileOf(row: Row, index: number): TorrentClientFile {
  const priority = jsonNumber(row[3]);
  return {
    index,
    path: jsonText(row[0]).replaceAll('\\', '/'),
    size: jsonNumber(row[1]),
    downloadedBytes: jsonNumber(row[2]),
    selected: priority !== SKIP,
    priority: priority === SKIP ? 0 : priority - NORMAL,
  };
}

/**
 * uTorrent has one number for "skipped" and "how urgent", so a skipped file has no
 * priority to keep: selecting it again makes it normal unless a priority is given, and
 * a priority given alone leaves a skipped file skipped.
 */
function targetPriority(current: number, change: { readonly selected?: boolean; readonly priority?: number }): number {
  if (change.selected === false) return SKIP;
  if (current === SKIP && change.selected !== true) return SKIP;
  if (change.priority !== undefined) return change.priority + NORMAL;
  return current === SKIP ? NORMAL : current;
}

function limitQuery(name: string, value: number | undefined): readonly string[] {
  if (value === undefined) return [];
  if (!Number.isFinite(value) || value < 0) throw clientError('invalid:limit');
  return [`s=${name}&v=${Math.round(value)}`];
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** How the adapter's methods reach the WebUI. */
interface Transport {
  readonly timeoutMs: number;
  /** One request, answered with the parsed body. */
  send(query: string, init?: RequestInit, limitMs?: number): Promise<Json>;
  /** A request that changes something, so a timeout leaves the outcome unknown. */
  change(query: string, init?: RequestInit): Promise<void>;
}

function createTransport(options: ClientOptions): Transport {
  const base = `${options.endpoint.url.replace(/\/+$/, '').replace(/\/gui$/, '')}/gui/`;
  const authorization = basicAuthorization(options.endpoint);
  const credentials: Record<string, string> = authorization === undefined ? {} : { authorization };
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current: Session | undefined;

  async function openSession(limitMs: number): Promise<Session> {
    const response = await requestClient({ ...options, timeoutMs: limitMs }, `${base}token.html`, { headers: credentials, credentials: 'include' });
    if (response.status !== 200) throw clientError('unavailable:bad-response', `HTTP ${response.status}`);
    const token = /<div[^>]*\bid=["']?token["']?[^>]*>([^<]+)<\/div>/i.exec(await readClientText(response))?.[1];
    if (token === undefined) throw clientError('unavailable:bad-response', 'the token page held no token');
    const cookie = response.headers
      .getSetCookie()
      .map((entry) => entry.split(';', 1)[0])
      .join('; ');
    return { token, cookie };
  }

  async function attempt(query: string, init: RequestInit, limitMs: number): Promise<Response> {
    current ??= await openSession(limitMs);
    const headers: Record<string, string> = current.cookie === "" ? { ...credentials } : { ...credentials, cookie: current.cookie };
    const url = `${base}?token=${encodeURIComponent(current.token)}&${query}`;
    return requestClient({ ...options, timeoutMs: limitMs }, url, { ...init, headers, credentials: 'include' });
  }

  /** uTorrent answers 400 to a token it no longer knows (it forgets them when restarted); a new one is fetched and the request sent again, once. */
  async function send(query: string, init: RequestInit = {}, limitMs = timeoutMs): Promise<Json> {
    let response = await attempt(query, init, limitMs);
    if (response.status === 400) {
      current = undefined;
      response = await attempt(query, init, limitMs);
    }
    if (response.status !== 200) throw clientError('unavailable:bad-response', `HTTP ${response.status}`);
    const answer = jsonRecord(await readClientJson(response));
    if (typeof answer.error === 'string') throw clientError('unavailable:rejected', answer.error.slice(0, 200));
    return answer;
  }

  async function change(query: string, init?: RequestInit): Promise<void> {
    try {
      await send(query, init);
    } catch (error) {
      throw afterSending(error);
    }
  }

  return { timeoutMs, send, change };
}

async function rows(webui: Transport, limitMs?: number): Promise<readonly Row[]> {
  const answer = await webui.send('list=1', {}, limitMs);
  return jsonList(answer.torrents).map(jsonList);
}

async function findRow(webui: Transport, infoHash: string, limitMs?: number): Promise<Row | undefined> {
  return (await rows(webui, limitMs)).find((row) => reportedHash(row[HASH]) === infoHash);
}

async function knownRow(webui: Transport, infoHash: string): Promise<Row> {
  const row = await findRow(webui, checkedHash(infoHash));
  if (row === undefined) throw clientError('unavailable:not-found');
  return row;
}

/** A torrent the program leaves out of its answer simply reads as having no limits and unknown privacy. */
async function propsFor(webui: Transport, hashes: readonly string[]): Promise<ReadonlyMap<string, Json>> {
  const found = new Map<string, Json>();
  for (let offset = 0; offset < hashes.length; offset += PROPS_PER_REQUEST) {
    const answer = await webui.send(`action=getprops&${hashes.slice(offset, offset + PROPS_PER_REQUEST).map(hashQuery).join('&')}`);
    for (const props of jsonList(answer.props ?? []).map(jsonRecord)) found.set(reportedHash(props.hash), props);
  }
  return found;
}

/** `getfiles` leaves `files` out for a torrent it does not have, and lists none for a magnet whose metadata has not arrived. */
async function fileRows(webui: Transport, infoHash: string): Promise<readonly Row[]> {
  const answer = await webui.send(`action=getfiles&${hashQuery(checkedHash(infoHash))}`);
  if (answer.files === undefined) throw clientError('unavailable:not-found');
  return jsonList(jsonList(answer.files)[1]).map(jsonList);
}

function sendTorrent(webui: Transport, source: TorrentClientSource, infoHash: string): Promise<void> {
  if (source.kind === 'magnet') {
    // `add-url` also takes an address for the program to fetch; only a magnet is ever put there.
    return webui.change(`action=add-url&s=${encodeURIComponent(source.magnet.replace(/^magnet:/i, 'magnet:'))}`);
  }
  const form = new FormData();
  form.append('torrent_file', new Blob([source.bytes as BlobPart], { type: 'application/x-bittorrent' }), `${infoHash}.torrent`);
  return webui.change('action=add-file', { method: 'POST', body: form });
}

/** Watches the list until the torrent is in it, for as long as one request may take. */
async function appeared(webui: Transport, infoHash: string): Promise<boolean> {
  const deadline = Date.now() + webui.timeoutMs;
  for (let left = webui.timeoutMs; left > 0; left = deadline - Date.now()) {
    if ((await findRow(webui, infoHash, left)) !== undefined) return true;
    await sleep(Math.min(POLL_MS, left));
  }
  return false;
}

/** The API does not name what it added, so the only confirmation is the torrent turning up in the list. */
async function confirmAdded(webui: Transport, infoHash: string): Promise<void> {
  const there = await appeared(webui, infoHash).catch(() => false);
  if (!there) throw clientError('unavailable:outcome-unknown', 'the torrent was sent but has not appeared in the list');
}

/**
 * Drives uTorrent (or BitTorrent, the same program) through its WebUI API.
 *
 * Every request carries a token scraped from `/gui/token.html` and the `GUID` cookie
 * set with it. A page cannot read `Set-Cookie` or write `Cookie` for a cross-origin
 * `fetch`, so requests ask for `credentials: 'include'` and leave the cookie to the
 * browser; a runtime that does expose `Set-Cookie` (Node, or a host's own `fetch`)
 * gets it forwarded by hand. In a browser this only works when the page shares
 * uTorrent's site: the program sends no cross-origin headers and its cookie carries no
 * `SameSite=None`, so from any other origin the answers are withheld and the adapter
 * rejects `unavailable:unreachable`. There the host supplies `fetch`.
 *
 * What the API cannot say is filled in by looking: an added torrent is not named in
 * the answer, so its info hash is computed here and the list is watched until it
 * appears; "add paused" is an add followed by a stop, so the torrent may run for a
 * moment first. `pause` stops the torrent, as Transmission's does, and `resume` starts
 * it or lifts uTorrent's own pause, whichever holds it.
 *
 * @param options - Where the WebUI answers, with its name and password.
 * @returns The torrent client.
 * @example
 * ```ts
 * const client = createUtorrentClient({ endpoint: { url: 'http://127.0.0.1:8080', username: 'admin', password: 'secret' } });
 * const { infoHash } = await client.add({ kind: 'metainfo', bytes });
 * await client.selectFiles(infoHash, [0, 2], { selected: false });
 * ```
 */
export function createUtorrentClient(options: ClientOptions): TorrentClient {
  const webui = createTransport(options);

  return {
    async probe(): Promise<ClientProbe> {
      const answer = await webui.send('list=1');
      return { version: String(jsonNumber(answer.build)) };
    },

    async add(source: TorrentClientSource, addOptions?: { readonly paused?: boolean }): Promise<{ readonly infoHash: string }> {
      const infoHash = source.kind === 'magnet' ? magnetInfoHash(source.magnet) : (await readTorrentMetainfo(source.bytes)).infoHash;
      // Sending a torrent the desktop program already has makes it ask the person a question in a dialog.
      if ((await findRow(webui, infoHash)) !== undefined) return { infoHash };
      await sendTorrent(webui, source, infoHash);
      await confirmAdded(webui, infoHash);
      if (addOptions?.paused === true) await webui.change(`action=stop&${hashQuery(infoHash)}`);
      return { infoHash };
    },

    async list(): Promise<readonly TorrentClientJob[]> {
      const all = await rows(webui);
      const props = await propsFor(webui, all.map((row) => reportedHash(row[HASH])));
      return all.map((row) => jobOf(row, props.get(reportedHash(row[HASH]))));
    },

    async get(infoHash: string): Promise<TorrentClientJob | undefined> {
      const row = await findRow(webui, checkedHash(infoHash));
      if (row === undefined) return undefined;
      return jobOf(row, (await propsFor(webui, [infoHash])).get(infoHash));
    },

    async files(infoHash: string): Promise<readonly TorrentClientFile[]> {
      return (await fileRows(webui, infoHash)).map(fileOf);
    },

    async selectFiles(infoHash: string, indexes: readonly number[], selection: { readonly selected?: boolean; readonly priority?: number }): Promise<void> {
      if (![undefined, -1, 0, 1].includes(selection.priority)) throw clientError('invalid:priority');
      const priorities = (await fileRows(webui, infoHash)).map((row) => jsonNumber(row[3]));
      if (!indexes.every((index) => Number.isInteger(index) && index >= 0 && index < priorities.length)) throw clientError('invalid:file-index');
      // Whatever is asked, every file that moves ends at the same priority, so one request carries them all.
      const moved = [...new Set(indexes)].filter((index) => targetPriority(priorities[index] as number, selection) !== priorities[index]);
      if (moved.length === 0) return;
      const priority = targetPriority(priorities[moved[0] as number] as number, selection);
      await webui.change(`action=setprio&${hashQuery(infoHash)}&p=${priority}&${moved.map((index) => `f=${index}`).join('&')}`);
    },

    async pause(infoHash: string): Promise<void> {
      await knownRow(webui, infoHash);
      await webui.change(`action=stop&${hashQuery(infoHash)}`);
    },

    async resume(infoHash: string): Promise<void> {
      const row = await knownRow(webui, infoHash);
      await webui.change(`action=${has(jsonNumber(row[STATUS]), PAUSED) ? 'unpause' : 'start'}&${hashQuery(infoHash)}`);
    },

    async remove(infoHash: string, deleteData: boolean): Promise<void> {
      await knownRow(webui, infoHash);
      await webui.change(`action=${deleteData ? 'removedata' : 'remove'}&${hashQuery(infoHash)}`);
    },

    async setLimits(infoHash: string, limits: TorrentClientLimits): Promise<void> {
      const pairs = [...limitQuery('dlrate', limits.downloadLimit), ...limitQuery('ulrate', limits.uploadLimit)];
      await knownRow(webui, infoHash);
      if (pairs.length > 0) await webui.change(`action=setprops&${hashQuery(infoHash)}&${pairs.join('&')}`);
    },
  };
}
