import { afterSending, basicAuthorization, clientError, jsonList, jsonNumber, jsonRecord, jsonText, readClientJson, requestClient } from './http';
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

const SESSION_HEADER = 'x-transmission-session-id';
/** Transmission's per-torrent limits are in kB/s, and its daemon counts 1000 bytes to the kB (`units.speed-bytes`). */
const BYTES_PER_LIMIT_UNIT = 1000;
/** `tr_stat.error`: 1 and 2 are a tracker's warning and error, which leave the torrent running; 3 is the torrent's own failure. */
const LOCAL_ERROR = 3;
const STATUS_STOPPED = 0;
const STATUS_DOWNLOADING = 4;
const STATUS_QUEUED_TO_SEED = 5;
const STATUS_SEEDING = 6;

const JOB_FIELDS = [
  'hashString',
  'name',
  'status',
  'error',
  'errorString',
  'metadataPercentComplete',
  'haveValid',
  'haveUnchecked',
  'uploadedEver',
  'totalSize',
  'leftUntilDone',
  'percentDone',
  'rateDownload',
  'rateUpload',
  'peersConnected',
  'trackerStats',
  'eta',
  'downloadLimit',
  'downloadLimited',
  'uploadLimit',
  'uploadLimited',
  'isPrivate',
];

const PRIORITY_KEYS: ReadonlyMap<number | undefined, string> = new Map([
  [-1, 'priority-low'],
  [0, 'priority-normal'],
  [1, 'priority-high'],
]);

/**
 * The RPC address for what the person typed: the web interface's root, its
 * `/transmission` folder or `/transmission/web` page all lead to `/transmission/rpc`,
 * and an address already ending in `/rpc` (a daemon with its own `rpc-url`) is kept.
 */
function rpcUrl(address: string): string {
  const base = address.replace(/\/+$/, '').replace(/\/web$/, '');
  return base.replace(/(\/transmission)?(\/rpc)?$/, (found: string, _folder?: string, rpc?: string) => (rpc === undefined ? '/transmission/rpc' : found));
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

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(text);
}

/**
 * A torrent is only called complete or seeding when Transmission's own status says so:
 * while it verifies local data (statuses 1 and 2) the progress it shows is not yet trusted.
 */
function stateOf(torrent: Json, hasMetadata: boolean): TorrentClientState {
  const status = jsonNumber(torrent.status);
  if (jsonNumber(torrent.error) === LOCAL_ERROR) return 'error';
  if (status === STATUS_SEEDING) return 'seeding';
  if (status === STATUS_QUEUED_TO_SEED) return 'complete';
  if (status === STATUS_DOWNLOADING) return hasMetadata ? 'downloading' : 'metadata';
  if (status !== STATUS_STOPPED) return 'queued';
  return hasMetadata && jsonNumber(torrent.leftUntilDone) === 0 ? 'complete' : 'paused';
}

/** The largest count any tracker last scraped; Transmission reports -1 for a tracker that has not answered. */
function swarmCount(torrent: Json, key: string): number {
  return Math.max(0, ...jsonList(torrent.trackerStats).map((tracker) => jsonNumber(jsonRecord(tracker)[key])));
}

function limitOf(torrent: Json, limited: string, limit: string): number {
  return torrent[limited] === true ? jsonNumber(torrent[limit]) * BYTES_PER_LIMIT_UNIT : 0;
}

function jobOf(value: unknown): TorrentClientJob {
  const torrent = jsonRecord(value);
  const hasMetadata = jsonNumber(torrent.metadataPercentComplete) >= 1;
  const state = stateOf(torrent, hasMetadata);
  const eta = jsonNumber(torrent.eta);
  return {
    infoHash: reportedHash(torrent.hashString),
    name: jsonText(torrent.name),
    state,
    downloadedBytes: jsonNumber(torrent.haveValid) + jsonNumber(torrent.haveUnchecked),
    uploadedBytes: jsonNumber(torrent.uploadedEver),
    // Until the metadata arrives Transmission reports size 0, progress 0 and "not private", none of which it knows.
    ...(hasMetadata ? { totalBytes: jsonNumber(torrent.totalSize), progress: jsonNumber(torrent.percentDone), private: torrent.isPrivate === true } : {}),
    downloadRate: jsonNumber(torrent.rateDownload),
    uploadRate: jsonNumber(torrent.rateUpload),
    peers: jsonNumber(torrent.peersConnected),
    seeds: swarmCount(torrent, 'seederCount'),
    leeches: swarmCount(torrent, 'leecherCount'),
    ...(eta >= 0 ? { etaSeconds: eta } : {}),
    downloadLimit: limitOf(torrent, 'downloadLimited', 'downloadLimit'),
    uploadLimit: limitOf(torrent, 'uploadLimited', 'uploadLimit'),
    ...(state === 'error' ? { error: jsonText(torrent.errorString) } : {}),
  };
}

/**
 * Transmission names a file by its path from the download folder, so a torrent that is
 * a folder repeats the torrent's name at the front of every file. That part is dropped
 * to leave the path inside the torrent.
 */
function filesOf(torrent: Json): readonly TorrentClientFile[] {
  const files = jsonList(torrent.files).map(jsonRecord);
  const stats = jsonList(torrent.fileStats);
  const folder = `${jsonText(torrent.name)}/`;
  const strip = files.every((file) => jsonText(file.name).startsWith(folder)) ? folder.length : 0;
  return files.map((file, index) => {
    const stat = jsonRecord(stats[index]);
    return {
      index,
      path: jsonText(file.name).slice(strip),
      size: jsonNumber(file.length),
      downloadedBytes: jsonNumber(file.bytesCompleted),
      selected: Boolean(stat.wanted),
      priority: Math.sign(jsonNumber(stat.priority)),
    };
  });
}

function limitArguments(value: number | undefined, limited: string, limit: string): Json {
  if (value === undefined) return {};
  if (!Number.isFinite(value) || value < 0) throw clientError('invalid:limit');
  return value === 0 ? { [limited]: false } : { [limited]: true, [limit]: Math.ceil(value / BYTES_PER_LIMIT_UNIT) };
}

function selectionArguments(indexes: readonly number[], change: { readonly selected?: boolean; readonly priority?: number }): Json {
  const priorityKey = PRIORITY_KEYS.get(change.priority);
  if (change.priority !== undefined && priorityKey === undefined) throw clientError('invalid:priority');
  if (!indexes.every((index) => Number.isInteger(index) && index >= 0)) throw clientError('invalid:file-index');
  return {
    ...(change.selected === undefined ? {} : { [change.selected ? 'files-wanted' : 'files-unwanted']: indexes }),
    ...(priorityKey === undefined ? {} : { [priorityKey]: indexes }),
  };
}

async function addArguments(source: TorrentClientSource): Promise<Json> {
  if (source.kind === 'metainfo') {
    await readTorrentMetainfo(source.bytes);
    return { metainfo: base64(source.bytes) };
  }
  magnetInfoHash(source.magnet);
  // `filename` also takes a path on the daemon's disk or an address for it to fetch; only a magnet is ever put there.
  return { filename: source.magnet.replace(/^magnet:/i, 'magnet:') };
}

/**
 * Drives a Transmission daemon through its RPC interface, in the classic request form
 * (`method`, `arguments`, `result`) that every version from 1.x to 4.x answers.
 *
 * Transmission answers a change to a torrent it does not have with success, so every
 * change first asks whether the torrent is there and rejects `unavailable:not-found`
 * when it is not. A torrent is reported as `error` only for its own failure; a tracker's
 * complaint leaves it in the state Transmission is working in.
 *
 * A web page on another origin cannot call the daemon directly: it sends no
 * cross-origin headers, so the browser withholds its answers. There the host supplies `fetch`.
 *
 * @param options - Where the daemon answers, with the name and password if it asks for them.
 * @returns The torrent client.
 * @example
 * ```ts
 * const client = createTransmissionClient({ endpoint: { url: 'http://127.0.0.1:9091', username: 'me', password: 'secret' } });
 * const { infoHash } = await client.add({ kind: 'magnet', magnet }, { paused: true });
 * await client.setLimits(infoHash, { downloadLimit: 500_000 });
 * ```
 */
export function createTransmissionClient(options: ClientOptions): TorrentClient {
  const url = rpcUrl(options.endpoint.url);
  const authorization = basicAuthorization(options.endpoint);
  let sessionId = '';

  function post(body: string): Promise<Response> {
    const headers = { 'content-type': 'application/json', [SESSION_HEADER]: sessionId, ...(authorization === undefined ? {} : { authorization }) };
    return requestClient(options, url, { method: 'POST', headers, body });
  }

  /** A 409 is the daemon handing over the session id it wants on every request (rpc-spec 2.3.1); the request is sent again with it, once. */
  async function call(method: string, args: Json): Promise<Json> {
    const body = JSON.stringify({ method, arguments: args });
    let response = await post(body);
    if (response.status === 409) {
      sessionId = response.headers.get(SESSION_HEADER) ?? '';
      response = await post(body);
    }
    if (response.status !== 200) throw clientError('unavailable:bad-response', `HTTP ${response.status}`);
    const answer = jsonRecord(await readClientJson(response));
    const result = jsonText(answer.result);
    if (result !== 'success') throw clientError('unavailable:rejected', result.slice(0, 200));
    return jsonRecord(answer.arguments);
  }

  async function change(method: string, args: Json): Promise<Json> {
    try {
      return await call(method, args);
    } catch (error) {
      throw afterSending(error);
    }
  }

  async function find(infoHash: string, fields: readonly string[]): Promise<unknown> {
    const answer = await call('torrent-get', { ids: [checkedHash(infoHash)], fields });
    return jsonList(answer.torrents)[0];
  }

  async function known(infoHash: string, fields: readonly string[]): Promise<Json> {
    const torrent = await find(infoHash, fields);
    if (torrent === undefined) throw clientError('unavailable:not-found');
    return jsonRecord(torrent);
  }

  async function changeKnown(infoHash: string, method: string, args: Json): Promise<void> {
    await known(infoHash, ['hashString']);
    await change(method, { ids: [infoHash], ...args });
  }

  return {
    async probe(): Promise<ClientProbe> {
      const session = await call('session-get', { fields: ['version'] });
      return { version: jsonText(session.version) };
    },

    async add(source: TorrentClientSource, addOptions?: { readonly paused?: boolean }): Promise<{ readonly infoHash: string }> {
      const paused = addOptions?.paused;
      const answer = await change('torrent-add', { ...(await addArguments(source)), ...(paused === undefined ? {} : { paused }) });
      const torrent = jsonRecord(answer['torrent-added'] ?? answer['torrent-duplicate']);
      return { infoHash: reportedHash(torrent.hashString) };
    },

    async list(): Promise<readonly TorrentClientJob[]> {
      const answer = await call('torrent-get', { fields: JOB_FIELDS });
      return jsonList(answer.torrents).map(jobOf);
    },

    async get(infoHash: string): Promise<TorrentClientJob | undefined> {
      const torrent = await find(infoHash, JOB_FIELDS);
      return torrent === undefined ? undefined : jobOf(torrent);
    },

    async files(infoHash: string): Promise<readonly TorrentClientFile[]> {
      return filesOf(await known(infoHash, ['name', 'files', 'fileStats']));
    },

    async selectFiles(infoHash: string, indexes: readonly number[], selection: { readonly selected?: boolean; readonly priority?: number }): Promise<void> {
      const args = selectionArguments(indexes, selection);
      const torrent = await known(infoHash, ['priorities']);
      const count = jsonList(torrent.priorities).length;
      if (indexes.some((index) => index >= count)) throw clientError('invalid:file-index');
      // An empty index list means "every file" to Transmission, so nothing is sent for one.
      if (indexes.length === 0 || Object.keys(args).length === 0) return;
      await change('torrent-set', { ids: [infoHash], ...args });
    },

    pause: (infoHash: string) => changeKnown(infoHash, 'torrent-stop', {}),

    resume: (infoHash: string) => changeKnown(infoHash, 'torrent-start', {}),

    remove: (infoHash: string, deleteData: boolean) => changeKnown(infoHash, 'torrent-remove', { 'delete-local-data': deleteData }),

    async setLimits(infoHash: string, limits: TorrentClientLimits): Promise<void> {
      const args = {
        ...limitArguments(limits.downloadLimit, 'downloadLimited', 'downloadLimit'),
        ...limitArguments(limits.uploadLimit, 'uploadLimited', 'uploadLimit'),
      };
      await changeKnown(infoHash, 'torrent-set', args);
    },
  };
}
