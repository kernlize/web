import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeTorrent, magnetHash } from './fake-transmission-torrents';

/**
 * A stand-in for a Transmission daemon that speaks its RPC protocol over a real socket.
 *
 * Statuses, headers, bodies and wording were copied from a real Transmission 4.1.4
 * container (`rpc-version` 19) answering the classic request form: the 401 and 409
 * pages, `session-get`, `torrent-add` (added, duplicate, "unrecognized info", "no
 * filename or metainfo specified"), `torrent-get` rows for a magnet without metadata,
 * a stopped, seeding and failed torrent, `trackerStats`, `files` and `fileStats`,
 * `torrent-set` ("file index out of range"), success for changes to unknown ids, "no
 * method name" for an unknown method, the parse error for a body that is not JSON, and
 * 405 for anything but POST.
 */

type Json = Record<string, unknown>;

export interface FakeTransmissionTorrent {
  id: number;
  hashString: string;
  name: string;
  status: number;
  error: number;
  errorString: string;
  metadataPercentComplete: number;
  haveValid: number;
  haveUnchecked: number;
  uploadedEver: number;
  totalSize: number;
  leftUntilDone: number;
  percentDone: number;
  rateDownload: number;
  rateUpload: number;
  peersConnected: number;
  trackerStats: Json[];
  eta: number;
  downloadLimit: number;
  downloadLimited: boolean;
  uploadLimit: number;
  uploadLimited: boolean;
  isPrivate: boolean;
  files: { name: string; length: number; bytesCompleted: number }[];
  fileStats: { bytesCompleted: number; priority: number; wanted: boolean }[];
  priorities: number[];
}

/** A way for one RPC method to go wrong that the daemon's own logic would not produce on demand. */
export interface TransmissionFault {
  readonly method: string;
  /** `silence` never answers, `hang-up` drops the connection, `stall` and `break` start a body and stop or cut it. */
  readonly kind: 'answer' | 'silence' | 'hang-up' | 'stall' | 'break';
  readonly status?: number;
  readonly body?: string;
}

export interface FakeTransmission {
  readonly url: string;
  /** Every RPC call that got past the password and session checks. */
  readonly calls: { readonly method: string; readonly arguments: Json }[];
  readonly torrents: Map<string, FakeTransmissionTorrent>;
  readonly removed: { readonly infoHash: string; readonly deleteData: boolean }[];
  readonly faults: TransmissionFault[];
  credentials: { readonly username: string; readonly password: string } | undefined;
  rpcPath: string;
  /** The daemon's `start-added-torrents` setting. */
  startAdded: boolean;
  /** How many requests were answered 409 for lacking the session id. */
  conflicts: number;
  namesSession: boolean;
  seed(torrent: Partial<FakeTransmissionTorrent> & { readonly hashString: string }): FakeTransmissionTorrent;
  /** Forgets the session id, as the real daemon does when it expires one. */
  newSession(): void;
  close(): Promise<void>;
}

const VERSION = '4.1.4 (a6d907d9ea)';
const UNAUTHORIZED = '<h1>401: Unauthorized</h1>';
const NOT_ALLOWED = '<h1>405: Method Not Allowed</h1>';

function conflictPage(session: string): string {
  return `<h1>409: Conflict</h1><p>Your request had an invalid session_id header.</p><p>To fix this, follow these steps:<ol><li> When reading a response, get its X-Transmission-Session-Id header and remember it<li> Add the updated header to your outgoing requests<li> When you get this 409 error message, resend your request with the updated header</ol></p><p>This requirement has been added to help prevent <a href="https://en.wikipedia.org/wiki/Cross-site_request_forgery">CSRF</a> attacks.</p><p><code>X-Transmission-Session-Id: ${session}</code></p>`;
}

function page(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { Server: 'Transmission', 'Content-Type': 'text/html; charset=ISO-8859-1', ...headers });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function tracker(announce: string, seederCount: number, leecherCount: number): Json {
  return { announce, announceState: 1, downloadCount: -1, hasAnnounced: true, hasScraped: seederCount >= 0, id: 1, isBackup: false, leecherCount, seederCount, tier: 0 };
}

function blank(id: number, hashString: string): FakeTransmissionTorrent {
  return {
    id,
    hashString,
    name: hashString,
    status: 0,
    error: 0,
    errorString: '',
    metadataPercentComplete: 0,
    haveValid: 0,
    haveUnchecked: 0,
    uploadedEver: 0,
    totalSize: 0,
    leftUntilDone: 0,
    percentDone: 0,
    rateDownload: 0,
    rateUpload: 0,
    peersConnected: 0,
    trackerStats: [],
    eta: -1,
    downloadLimit: 100,
    downloadLimited: false,
    uploadLimit: 100,
    uploadLimited: false,
    isPrivate: false,
    files: [],
    fileStats: [],
    priorities: [],
  };
}

/** Lays out files the way the daemon reports them: by path from the download folder. */
export function transmissionFiles(name: string, files: readonly { readonly path: string; readonly length: number }[]): Pick<FakeTransmissionTorrent, 'files' | 'fileStats' | 'priorities' | 'totalSize' | 'leftUntilDone' | 'metadataPercentComplete' | 'name'> {
  const folder = files.length === 1 && files[0]?.path === name ? '' : `${name}/`;
  const totalSize = files.reduce((sum, file) => sum + file.length, 0);
  return {
    name,
    files: files.map((file) => ({ name: `${folder}${file.path}`, length: file.length, bytesCompleted: 0 })),
    fileStats: files.map(() => ({ bytesCompleted: 0, priority: 0, wanted: true })),
    priorities: files.map(() => 0),
    totalSize,
    leftUntilDone: totalSize,
    metadataPercentComplete: 1,
  };
}

export { tracker as transmissionTracker };

/** The daemon's state, with the parts a scenario has no business touching. */
interface Daemon extends FakeTransmission {
  session: string;
  nextId: number;
}

type Answer = [result: string, answer: Json];

function seed(daemon: Daemon, torrent: Partial<FakeTransmissionTorrent> & { readonly hashString: string }): FakeTransmissionTorrent {
  const seeded = { ...blank(daemon.nextId++, torrent.hashString), ...torrent };
  daemon.torrents.set(seeded.hashString, seeded);
  return seeded;
}

function chosen(daemon: Daemon, ids: unknown): FakeTransmissionTorrent[] {
  const all = [...daemon.torrents.values()];
  if (!Array.isArray(ids)) return all;
  return all.filter((torrent) => ids.includes(torrent.hashString) || ids.includes(torrent.id));
}

function sourceOf(args: Json): { infoHash: string; torrent: Partial<FakeTransmissionTorrent> } | undefined {
  if (typeof args.metainfo === 'string') {
    const decoded = decodeTorrent(Buffer.from(args.metainfo, 'base64'));
    return decoded && { infoHash: decoded.infoHash, torrent: { ...transmissionFiles(decoded.name, decoded.files), isPrivate: decoded.private } };
  }
  const link = String(args.filename);
  const infoHash = magnetHash(link);
  return infoHash === undefined ? undefined : { infoHash, torrent: { name: new URLSearchParams(link.slice(8)).get('dn') ?? infoHash } };
}

function add(daemon: Daemon, args: Json): Answer {
  if (typeof args.metainfo !== 'string' && typeof args.filename !== 'string') return ['no filename or metainfo specified', {}];
  const source = sourceOf(args);
  if (!source) return ['unrecognized info', {}];
  const existing = daemon.torrents.get(source.infoHash);
  const paused = typeof args.paused === 'boolean' ? args.paused : !daemon.startAdded;
  const torrent = existing ?? seed(daemon, { hashString: source.infoHash, ...source.torrent, status: paused ? 0 : 4 });
  return ['success', { [existing ? 'torrent-duplicate' : 'torrent-added']: { hashString: torrent.hashString, id: torrent.id, name: torrent.name } }];
}

/** An empty list means every file, as the RPC specification says. */
function indexes(torrent: FakeTransmissionTorrent, value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return [];
  const list = value.length === 0 ? torrent.priorities.map((_, index) => index) : (value as number[]);
  return list.every((index) => index >= 0 && index < torrent.priorities.length) ? list : undefined;
}

function setOne(torrent: FakeTransmissionTorrent, args: Json): boolean {
  const lists = ['files-wanted', 'files-unwanted', 'priority-low', 'priority-normal', 'priority-high'].map((key) => indexes(torrent, args[key]));
  if (lists.includes(undefined)) return false;
  const [wanted, unwanted, low, normal, high] = lists as number[][];
  for (const index of wanted ?? []) (torrent.fileStats[index] as { wanted: boolean }).wanted = true;
  for (const index of unwanted ?? []) (torrent.fileStats[index] as { wanted: boolean }).wanted = false;
  for (const [priority, list] of [[-1, low], [0, normal], [1, high]] as const) {
    for (const index of list ?? []) {
      torrent.priorities[index] = priority;
      (torrent.fileStats[index] as { priority: number }).priority = priority;
    }
  }
  for (const key of ['downloadLimit', 'downloadLimited', 'uploadLimit', 'uploadLimited']) {
    if (args[key] !== undefined) Reflect.set(torrent, key, args[key]);
  }
  return true;
}

function run(daemon: Daemon, method: unknown, args: Json): Answer {
  const torrents = chosen(daemon, args.ids);
  if (method === 'session-get') return ['success', { version: VERSION }];
  if (method === 'torrent-add') return add(daemon, args);
  if (method === 'torrent-set') return torrents.every((torrent) => setOne(torrent, args)) ? ['success', {}] : ['file index out of range', {}];
  if (method === 'torrent-get') {
    const fields = args.fields as string[];
    return ['success', { torrents: torrents.map((torrent) => Object.fromEntries(fields.map((field) => [field, Reflect.get(torrent, field)]))) }];
  }
  if (method === 'torrent-stop' || method === 'torrent-start') {
    for (const torrent of torrents) torrent.status = method === 'torrent-stop' ? 0 : torrent.metadataPercentComplete === 1 && torrent.leftUntilDone === 0 ? 6 : 4;
    return ['success', {}];
  }
  if (method !== 'torrent-remove') return ['no method name', {}];
  for (const torrent of torrents) {
    daemon.torrents.delete(torrent.hashString);
    daemon.removed.push({ infoHash: torrent.hashString, deleteData: args['delete-local-data'] === true });
  }
  return ['success', {}];
}

function fail(fault: TransmissionFault, response: ServerResponse): void {
  if (fault.kind === 'silence') return;
  if (fault.kind === 'hang-up') return void response.destroy();
  if (fault.kind === 'answer') return void response.writeHead(fault.status ?? 200, { 'Content-Type': 'application/json; charset=UTF-8' }).end(fault.body);
  response.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Content-Length': '4096' });
  response.write('{"arguments":{');
  if (fault.kind === 'break') setTimeout(() => response.destroy(), 20);
}

function authorised(daemon: Daemon, request: IncomingMessage): boolean {
  if (!daemon.credentials) return true;
  const expected = `Basic ${Buffer.from(`${daemon.credentials.username}:${daemon.credentials.password}`).toString('base64')}`;
  return request.headers.authorization === expected;
}

function answerRpc(daemon: Daemon, body: Buffer, response: ServerResponse): void {
  response.setHeader('Content-Type', 'application/json; charset=UTF-8');
  let call: Json;
  try {
    call = JSON.parse(body.toString()) as Json;
  } catch {
    return void response.end('{"error":{"code":-32700,"data":{"error_string":"Couldn\'t parse JSON"},"message":"Parse error"},"id":null,"jsonrpc":"2.0"}');
  }
  const args = (call.arguments ?? {}) as Json;
  daemon.calls.push({ method: String(call.method), arguments: args });
  const fault = daemon.faults.find((candidate) => candidate.method === call.method);
  if (fault) return fail(fault, response);
  const [result, answer] = run(daemon, call.method, args);
  response.end(JSON.stringify({ arguments: answer, result, ...(call.tag === undefined ? {} : { tag: call.tag }) }));
}

function handle(daemon: Daemon, request: IncomingMessage, body: Buffer, response: ServerResponse): void {
  if (!authorised(daemon, request)) return page(response, 401, UNAUTHORIZED, { 'WWW-Authenticate': 'Basic realm="Transmission"' });
  if (new URL(request.url ?? '/', daemon.url).pathname !== daemon.rpcPath) return page(response, 404, '<h1>404: Not Found</h1>');
  if (request.method !== 'POST') return page(response, 405, NOT_ALLOWED);
  if (request.headers['x-transmission-session-id'] === daemon.session) return answerRpc(daemon, body, response);
  daemon.conflicts += 1;
  page(response, 409, conflictPage(daemon.session), daemon.namesSession ? { 'X-Transmission-Session-Id': daemon.session, 'X-Transmission-Rpc-Version': '6.0.1' } : {});
}

export async function startFakeTransmission(): Promise<FakeTransmission> {
  const server = createServer((request, response) => {
    void readBody(request).then((body) => handle(daemon, request, body, response));
  });
  const daemon: Daemon = {
    url: '',
    session: 'kT1cYkq0S0dBvWqM9xE1mX2yD8nRzP4aQhUoL7sJ6fGtC3wV',
    nextId: 1,
    calls: [],
    torrents: new Map(),
    removed: [],
    faults: [],
    credentials: undefined,
    rpcPath: '/transmission/rpc',
    startAdded: true,
    conflicts: 0,
    namesSession: true,
    seed: (torrent) => seed(daemon, torrent),
    newSession: () => {
      daemon.session = `${daemon.session.slice(1)}${daemon.session.slice(0, 1)}`;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  Object.assign(daemon, { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  return daemon;
}
