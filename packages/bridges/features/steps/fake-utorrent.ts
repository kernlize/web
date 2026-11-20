import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeTorrent, magnetHash } from './fake-transmission-torrents';

/**
 * A stand-in for uTorrent's WebUI that speaks its API over a real socket.
 *
 * uTorrent has no maintained container to copy answers from, so everything here follows
 * the published WebUI API pages ("Torrent/labels List", "Files List", "Torrent Job
 * Properties", "Actions"): the torrent row's nineteen positions and its status bits,
 * `getfiles`, `getprops` and `setprops`, `setprio`, `start`, `stop`, `pause`, `unpause`,
 * `remove`, `removedata`, `add-url` and the multipart `add-file`. The token page, its
 * `GUID` cookie and the 400 "invalid request" for a token the program does not know
 * follow how long-lived clients of the API are written. Two things are from the same
 * sources rather than the API pages, and are marked where they appear: the status line
 * uTorrent 3.x appends to a row, and an `error` member in an answer that declines.
 */

type Json = Record<string, unknown>;

export interface FakeUtorrentTorrent {
  /** Uppercase, as the program prints it. */
  hash: string;
  status: number;
  name: string;
  size: number;
  /** Per mille. */
  progress: number;
  downloaded: number;
  uploaded: number;
  uploadSpeed: number;
  downloadSpeed: number;
  eta: number;
  peersConnected: number;
  peersInSwarm: number;
  seedsConnected: number;
  seedsInSwarm: number;
  remaining: number;
  /** The status line uTorrent 3.x puts at position 21; absent, the row has the nineteen published positions. */
  message?: string;
  /** Name, size, downloaded, priority; undefined until the metadata is known. */
  files: [string, number, number, number][] | undefined;
  props: { trackers: string; ulrate: number; dlrate: number; superseed: number; dht: number; pex: number; seed_override: number; seed_ratio: number; seed_time: number; ulslots: number };
}

/** A way for one kind of request to go wrong that the program's own logic would not produce on demand. */
export interface UtorrentFault {
  /** An action name, `list`, or `token` for the token page. */
  readonly action: string;
  readonly kind: 'answer' | 'silence' | 'hang-up' | 'stall' | 'break';
  readonly status?: number;
  readonly body?: string;
  /** How many matching requests to answer properly first. */
  skip: number;
}

export interface UtorrentRequest {
  readonly action: string;
  readonly method: string;
  /** The query after the token, as sent. */
  readonly query: string;
  readonly tokenFirst: boolean;
  readonly cookie: string | undefined;
  /** For `add-file`: the upload's field name, file name and bytes. */
  readonly upload?: { readonly field: string; readonly filename: string; readonly bytes: Buffer };
}

export interface FakeUtorrent {
  readonly url: string;
  readonly requests: UtorrentRequest[];
  readonly torrents: Map<string, FakeUtorrentTorrent>;
  readonly removed: { readonly infoHash: string; readonly deleteData: boolean }[];
  readonly faults: UtorrentFault[];
  credentials: { readonly username: string; readonly password: string };
  tokensIssued: number;
  setsCookie: boolean;
  reportsProps: boolean;
  /** When a torrent that was sent shows up in the list: at once, after this many milliseconds, or never. */
  arrival: number | 'never';
  seed(torrent: Partial<FakeUtorrentTorrent> & { readonly hash: string }): FakeUtorrentTorrent;
  /** Forgets every token, as the program does when it starts again. */
  restart(): void;
  close(): Promise<void>;
}

const BUILD = 44_994;
/** Loaded, queued, checked and started: an ordinary running torrent. */
export const UTORRENT_RUNNING = 201;
/** Loaded and checked: stopped. */
export const UTORRENT_STOPPED = 136;
const PAUSED = 32;

function blank(hash: string): FakeUtorrentTorrent {
  return {
    hash: hash.toUpperCase(),
    status: UTORRENT_RUNNING,
    name: hash.toUpperCase(),
    size: 0,
    progress: 0,
    downloaded: 0,
    uploaded: 0,
    uploadSpeed: 0,
    downloadSpeed: 0,
    eta: -1,
    peersConnected: 0,
    peersInSwarm: 0,
    seedsConnected: 0,
    seedsInSwarm: 0,
    remaining: 0,
    files: undefined,
    props: { trackers: '', ulrate: 0, dlrate: 0, superseed: 0, dht: 1, pex: 1, seed_override: 0, seed_ratio: 0, seed_time: 0, ulslots: 0 },
  };
}

function row(torrent: FakeUtorrentTorrent, order: number): unknown[] {
  const ratio = torrent.downloaded === 0 ? 0 : Math.round((torrent.uploaded / torrent.downloaded) * 1000);
  const published = [
    torrent.hash,
    torrent.status,
    torrent.name,
    torrent.size,
    torrent.progress,
    torrent.downloaded,
    torrent.uploaded,
    ratio,
    torrent.uploadSpeed,
    torrent.downloadSpeed,
    torrent.eta,
    '',
    torrent.peersConnected,
    torrent.peersInSwarm,
    torrent.seedsConnected,
    torrent.seedsInSwarm,
    65_536,
    order,
    torrent.remaining,
  ];
  return torrent.message === undefined ? published : [...published, '', '', torrent.message, '0', 1_700_000_000, 0, '', ''];
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function uploadOf(request: IncomingMessage, body: Buffer): Promise<UtorrentRequest['upload']> {
  const type = request.headers['content-type'];
  if (request.method !== 'POST' || !type) return undefined;
  const form = await new Response(new Uint8Array(body), { headers: { 'content-type': type } }).formData();
  const [entry] = [...form.entries()];
  if (!entry || typeof entry[1] === 'string') return undefined;
  return { field: entry[0], filename: entry[1].name, bytes: Buffer.from(await entry[1].arrayBuffer()) };
}

/** The program's state, with the parts a scenario has no business touching. */
interface Program extends FakeUtorrent {
  /** Token to the `GUID` cookie handed out with it. */
  readonly sessions: Map<string, string>;
}

const STATUS_AFTER: Record<string, (status: number) => number> = {
  start: () => UTORRENT_RUNNING,
  stop: () => UTORRENT_STOPPED,
  pause: (status) => (status % 2 === 1 ? UTORRENT_RUNNING + PAUSED : status),
  unpause: (status) => (Math.floor(status / PAUSED) % 2 === 1 ? status - PAUSED : status),
};

function seed(program: Program, torrent: Partial<FakeUtorrentTorrent> & { readonly hash: string }): FakeUtorrentTorrent {
  const seeded = { ...blank(torrent.hash), ...torrent, hash: torrent.hash.toUpperCase() };
  program.torrents.set(torrent.hash.toLowerCase(), seeded);
  return seeded;
}

function arrive(program: Program, torrent: Partial<FakeUtorrentTorrent> & { readonly hash: string }): void {
  if (program.torrents.has(torrent.hash) || program.arrival === 'never') return;
  if (program.arrival === 0) seed(program, torrent);
  else setTimeout(() => seed(program, torrent), program.arrival).unref();
}

function addUrl(program: Program, link: string): void {
  const hash = magnetHash(link);
  if (hash) arrive(program, { hash, name: new URLSearchParams(link.slice(8)).get('dn') ?? hash.toUpperCase() });
}

function addFile(program: Program, bytes: Buffer): Json {
  const decoded = decodeTorrent(bytes);
  // Not on the API pages: the wording uTorrent is known to answer a file it cannot read with.
  if (!decoded) return { error: "Can't add torrent: torrent is not valid bencoding!" };
  const size = decoded.files.reduce((sum, file) => sum + file.length, 0);
  const files = decoded.files.map((file): [string, number, number, number] => [file.path.replaceAll('/', '\\'), file.length, 0, 2]);
  arrive(program, { hash: decoded.infoHash, name: decoded.name, size, remaining: size, files, props: { ...blank('').props, ...(decoded.private ? { dht: -1, pex: -1 } : {}) } });
  return {};
}

/** Each `hash` names the torrent the `s` and `v` pairs after it apply to. */
function setProps(program: Program, params: URLSearchParams): void {
  let torrent: FakeUtorrentTorrent | undefined;
  let name = '';
  for (const [key, value] of params) {
    if (key === 'hash') torrent = program.torrents.get(value.toLowerCase());
    if (key === 's') name = value;
    if (key === 'v' && torrent) Reflect.set(torrent.props, name, Number(value));
  }
}

function change(program: Program, action: string, torrent: FakeUtorrentTorrent, params: URLSearchParams): void {
  const next = STATUS_AFTER[action];
  if (next) torrent.status = next(torrent.status);
  if (action === 'setprio') for (const file of params.getAll('f')) ((torrent.files as number[][])[Number(file)] as number[])[3] = Number(params.get('p'));
  if (action !== 'remove' && action !== 'removedata') return;
  program.torrents.delete(torrent.hash.toLowerCase());
  program.removed.push({ infoHash: torrent.hash.toLowerCase(), deleteData: action === 'removedata' });
}

function act(program: Program, action: string, params: URLSearchParams, upload: UtorrentRequest['upload']): Json {
  const chosen = params.getAll('hash').flatMap((hash) => program.torrents.get(hash.toLowerCase()) ?? []);
  const [first] = chosen;
  if (action === 'list') return { label: [], torrents: [...program.torrents.values()].map(row), torrentc: '1367230263' };
  if (action === 'getfiles') return first?.files ? { files: [first.hash, first.files] } : {};
  if (action === 'getprops') return program.reportsProps && chosen.length > 0 ? { props: chosen.map((torrent) => ({ hash: torrent.hash, ...torrent.props })) } : {};
  if (action === 'add-file') return addFile(program, upload?.field === 'torrent_file' ? upload.bytes : Buffer.alloc(0));
  if (action === 'setprops') setProps(program, params);
  if (action === 'add-url') addUrl(program, params.get('s') ?? '');
  for (const torrent of chosen) change(program, action, torrent, params);
  return {};
}

function fail(fault: UtorrentFault, response: ServerResponse): void {
  if (fault.kind === 'silence') return;
  if (fault.kind === 'hang-up') return void response.destroy();
  if (fault.kind === 'answer') return void response.writeHead(fault.status ?? 200, { 'Content-Type': 'text/plain' }).end(fault.body);
  response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '4096' });
  response.write('{"build":');
  if (fault.kind === 'break') setTimeout(() => response.destroy(), 20);
}

function faulted(program: Program, action: string, response: ServerResponse): boolean {
  const fault = program.faults.find((candidate) => candidate.action === action);
  if (!fault || fault.skip-- > 0) return false;
  fail(fault, response);
  return true;
}

function authorised(program: Program, request: IncomingMessage): boolean {
  const expected = `Basic ${Buffer.from(`${program.credentials.username}:${program.credentials.password}`).toString('base64')}`;
  return request.headers.authorization === expected;
}

function tokenPage(program: Program, response: ServerResponse): void {
  if (faulted(program, 'token', response)) return;
  program.tokensIssued += 1;
  const token = `Tk${program.tokensIssued}_x9-QmZ3v7Lw==`;
  const guid = `Gd${program.tokensIssued}b7c1e5f0a94d2`;
  program.sessions.set(token, guid);
  response.writeHead(200, { 'Content-Type': 'text/html', ...(program.setsCookie ? { 'Set-Cookie': `GUID=${guid}; path=/` } : {}) });
  response.end(`<html><div id='token' style='display:none;'>${token}</div></html>`);
}

async function api(program: Program, request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const body = await readBody(request);
  const guid = program.sessions.get(url.searchParams.get('token') ?? '');
  const cookie = request.headers.cookie;
  if (guid === undefined || (program.setsCookie && cookie !== `GUID=${guid}`)) return void response.writeHead(400, { 'Content-Type': 'text/plain' }).end('\ninvalid request');
  const action = url.searchParams.get('action') ?? (url.searchParams.get('list') === '1' ? 'list' : '');
  const upload = await uploadOf(request, body);
  program.requests.push({
    action,
    method: String(request.method),
    query: url.search.replace(/^\?token=[^&]*&?/, ''),
    tokenFirst: url.search.startsWith('?token='),
    cookie,
    ...(upload ? { upload } : {}),
  });
  if (faulted(program, action, response)) return;
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end(JSON.stringify({ build: BUILD, ...act(program, action, url.searchParams, upload) }));
}

function handle(program: Program, request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', program.url);
  if (!authorised(program, request)) return void response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="uTorrent"', 'Content-Type': 'text/plain' }).end('Unauthorized');
  if (url.pathname === '/gui/token.html') return tokenPage(program, response);
  if (url.pathname !== '/gui/') return void response.writeHead(404, { 'Content-Type': 'text/plain' }).end('invalid request');
  void api(program, request, response, url);
}

export async function startFakeUtorrent(): Promise<FakeUtorrent> {
  const server = createServer((request, response) => handle(program, request, response));
  const program: Program = {
    url: '',
    sessions: new Map(),
    requests: [],
    torrents: new Map(),
    removed: [],
    faults: [],
    credentials: { username: 'admin', password: '' },
    tokensIssued: 0,
    setsCookie: true,
    reportsProps: true,
    arrival: 0,
    seed: (torrent) => seed(program, torrent),
    restart: () => program.sessions.clear(),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  Object.assign(program, { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  return program;
}
