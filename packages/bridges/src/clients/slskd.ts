import { clientError, readClientJson, readClientText, requestClient } from './http';
import type {
  ClientOptions,
  ClientProbe,
  SoulseekClient,
  SoulseekClientFailure,
  SoulseekClientFile,
  SoulseekClientSearch,
  SoulseekClientTransfer,
  SoulseekClientTransferState,
} from './types';

type Json = Record<string, unknown>;

/** What a search was started with, kept so its results can be narrowed and bounded the same way each time they are read. */
interface SearchTerms {
  readonly username: string | undefined;
  readonly limit: number;
}

/** One signed-in line to a daemon: how requests are sent, and what is remembered between them. */
interface Daemon {
  call(method: string, path: string, body?: string): Promise<Response>;
  readonly searches: Map<string, SearchTerms>;
}

const DECIMAL = /^(0|[1-9]\d*)$/;
/** slskd holds a size in a signed 64-bit integer. */
const LARGEST_SIZE = 9_223_372_036_854_775_807n;
const LARGEST_TIMEOUT_MS = 2_147_483_647;
const SMALLEST_TIMEOUT_MS = 5;
/** U+0000 or a surrogate without its pair: text NAP-SOULSEEK does not allow across the wire. */
const MALFORMED_TEXT = /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Every Soulseek.NET call that needs the network starts its refusal this way when the daemon is offline. */
const NOT_SIGNED_IN = /must be connected and logged in/i;
/** Soulseek.NET's words for a peer that is not there, and for one that turned the transfer down. */
const PEER_GONE = /offline|connect(ion)? to/i;
const PEER_REFUSED = /reported as failed|rejected|not shared|banned/i;
/** A separator, a dotted name or number, a port, or a run of colons: the daemon's words might name a path on its disk or an address. */
const MAY_NAME_A_PLACE = /[\\/]|[\w-]\.[\w-]|:\d|:[0-9a-f]*:/i;
const LONGEST_MESSAGE = 200;

const FAILURE_WORDS: Record<SoulseekClientFailure, string> = {
  peer_unavailable: 'The peer could not be reached',
  peer_denied: 'The peer refused the transfer',
  timeout: 'The transfer timed out',
  limit_exceeded: 'The transfer went over a limit',
  backend_error: 'The transfer failed in the daemon',
};

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function records(value: unknown): readonly Json[] {
  return list(value).filter(isRecord);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && !MALFORMED_TEXT.test(value) ? value : undefined;
}

/** JSON carries the daemon's 64-bit numbers as doubles, so anything past 2^53 has already lost its last digits and cannot be trusted. */
function count(value: unknown, least: number): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= least ? value : undefined;
}

/**
 * One path segment for a name or id. `.` and `..` cannot be sent: a URL parser folds
 * them away even when they are percent-encoded, and the request would land elsewhere.
 */
function segment(value: string, what: 'username' | 'id'): string {
  if (value === '' || value === '.' || value === '..') throw clientError(`invalid:${what}`);
  return encodeURIComponent(value);
}

function uuid(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/**
 * Turns an answer that is not a success into the contract's reason. The daemon's own
 * words are read only to recognise them; they can hold a peer's address, so none are
 * passed on.
 *
 * `peer` marks a request that makes the daemon reach a peer: there 404 is slskd's
 * "the peer is offline", and a 5xx is the peer connection failing.
 */
async function refuse(response: Response, peer = false): Promise<never> {
  const words = await readClientText(response);
  const status = response.status;
  if (NOT_SIGNED_IN.test(words)) throw clientError('unavailable:rejected', 'the daemon is not signed in to the network');
  if (peer && (status === 404 || status >= 500)) throw new Error('unavailable:peer-unavailable');
  if (status === 404) throw clientError('unavailable:not-found');
  if (status === 400 || status === 409 || status === 429) throw clientError('unavailable:rejected', 'the daemon declined the request');
  throw clientError('unavailable:bad-response', `the daemon answered ${status}`);
}

async function readRecord(response: Response, peer = false): Promise<Json> {
  if (!response.ok) return refuse(response, peer);
  const body = await readClientJson(response);
  if (!isRecord(body)) throw clientError('unavailable:bad-response', 'the answer was not what slskd sends');
  return body;
}

function connect(options: ClientOptions): Daemon {
  const { apiKey, username, password } = options.endpoint;
  const base = `${options.endpoint.url.replace(/\/+$/, '')}/api/v0`;
  const signsIn = apiKey === undefined && (username ?? password) !== undefined;
  let token: Promise<string> | undefined;

  async function signIn(): Promise<string> {
    const response = await requestClient(options, `${base}/session`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ username: username ?? '', password: password ?? '' }),
    });
    // slskd answers 400, not 401, when the name or the password is blank.
    if (response.status === 400) throw clientError('denied:credentials');
    const jwt = text((await readRecord(response)).token);
    if (jwt === undefined) throw clientError('unavailable:bad-response', 'the daemon did not start a session');
    return jwt;
  }

  async function authorization(): Promise<Record<string, string>> {
    if (apiKey !== undefined) return { 'x-api-key': apiKey };
    if (!signsIn) return {};
    token ??= signIn();
    try {
      return { authorization: `Bearer ${await token}` };
    } catch (error) {
      token = undefined;
      throw error;
    }
  }

  async function send(method: string, path: string, body?: string): Promise<Response> {
    const headers = { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(await authorization()) };
    return requestClient(options, `${base}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
  }

  async function call(method: string, path: string, body?: string): Promise<Response> {
    try {
      return await send(method, path, body);
    } catch (error) {
      if (token === undefined || !String((error as Error).message).startsWith('denied:credentials')) throw error;
      // slskd signs sessions with a key it makes anew at every start, so a token it refuses may only be stale. A refusal changed nothing, so asking again after signing in afresh is safe.
      token = undefined;
      return send(method, path, body);
    }
  }

  return { call, searches: new Map() };
}

function toFile(username: string, path: unknown, raw: Json, locked: boolean): SoulseekClientFile | undefined {
  const remotePath = text(path);
  const size = count(raw.size, 0);
  if (remotePath === undefined || size === undefined) return undefined;
  const extension = text(raw.extension);
  const bitrateKbps = count(raw.bitRate, 1);
  const durationSeconds = count(raw.length, 0);
  const sampleRateHz = count(raw.sampleRate, 1);
  const bitDepth = count(raw.bitDepth, 1);
  return {
    username,
    path: remotePath,
    size: String(size),
    locked,
    ...(extension === undefined ? {} : { extension }),
    ...(bitrateKbps === undefined ? {} : { bitrateKbps }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(sampleRateHz === undefined ? {} : { sampleRateHz }),
    ...(bitDepth === undefined ? {} : { bitDepth }),
  };
}

function isFile(file: SoulseekClientFile | undefined): file is SoulseekClientFile {
  return file !== undefined;
}

function responseFiles(response: Json, wanted: string | undefined): readonly SoulseekClientFile[] {
  const username = text(response.username);
  if (username === undefined || (wanted !== undefined && username !== wanted)) return [];
  const open = records(response.files).map((file) => toFile(username, file.filename, file, false));
  const locked = records(response.lockedFiles).map((file) => toFile(username, file.filename, file, true));
  return [...open, ...locked].filter(isFile);
}

/**
 * A browse answer names each folder in full and each file by its last part only. Most
 * peers separate with `\`, a few with `/`; like slskd's own interface, take whichever
 * the first folder name shows.
 */
function separatorOf(directories: readonly Json[]): string {
  const first = directories.map((directory) => /[\\/]/.exec(String(directory.name))).find((match) => match !== null);
  return first?.[0] ?? '\\';
}

function directoryFiles(username: string, directory: Json, separator: string, locked: boolean): readonly SoulseekClientFile[] {
  const folder = directory.name;
  if (typeof folder !== 'string') return [];
  const prefix = folder === '' ? '' : `${folder}${separator}`;
  return records(directory.files)
    .map((file) => toFile(username, typeof file.filename === 'string' && file.filename !== '' ? `${prefix}${file.filename}` : undefined, file, locked))
    .filter(isFile);
}

function failed(failure: SoulseekClientFailure): { state: SoulseekClientTransferState; failure: SoulseekClientFailure } {
  return { state: 'failed', failure };
}

/** slskd reports a transfer's state as the names of the flags set in Soulseek.NET's `TransferStates`, joined by a comma and a space. */
function outcome(flags: ReadonlySet<string>, words: string): { state: SoulseekClientTransferState; failure?: SoulseekClientFailure } {
  if (!flags.has('Completed')) return { state: flags.has('InProgress') ? 'transferring' : 'queued' };
  if (flags.has('Succeeded')) return { state: 'complete' };
  if (flags.has('Cancelled')) return { state: 'cancelled' };
  if (flags.has('TimedOut')) return failed('timeout');
  if (flags.has('Rejected')) return failed('peer_denied');
  if (PEER_GONE.test(words)) return failed('peer_unavailable');
  if (PEER_REFUSED.test(words)) return failed('peer_denied');
  return failed('backend_error');
}

function failureMessage(failure: SoulseekClientFailure, words: string): string {
  const said = words.trim();
  return said === '' || said.length > LONGEST_MESSAGE || MAY_NAME_A_PLACE.test(said) ? FAILURE_WORDS[failure] : said;
}

function toTransfer(raw: Json): SoulseekClientTransfer {
  const id = text(raw.id);
  const username = text(raw.username);
  const path = text(raw.filename);
  const size = count(raw.size, 0);
  const received = count(raw.bytesTransferred, 0);
  if (id === undefined || username === undefined || path === undefined || size === undefined || received === undefined || typeof raw.state !== 'string') {
    throw clientError('unavailable:bad-response', 'the answer was not a transfer');
  }
  const words = typeof raw.exception === 'string' ? raw.exception : '';
  const { state, failure } = outcome(new Set(raw.state.split(',').map((flag) => flag.trim())), words);
  const queuePosition = state === 'queued' ? count(raw.placeInQueue, 1) : undefined;
  const speed = state === 'transferring' ? count(Math.round(Number(raw.averageSpeed)), 0) : undefined;
  return {
    id,
    username,
    path,
    size: String(size),
    state,
    received: String(received),
    ...(queuePosition === undefined ? {} : { queuePosition }),
    ...(speed === undefined ? {} : { bytesPerSecond: speed }),
    ...(failure === undefined ? {} : { failure, message: failureMessage(failure, words) }),
  };
}

async function probe(daemon: Daemon): Promise<ClientProbe> {
  const body = await readRecord(await daemon.call('GET', '/application'));
  const version = isRecord(body.version) ? text(body.version.current) : undefined;
  if (version === undefined) throw clientError('unavailable:bad-response', 'the answer was not what slskd sends');
  return { version };
}

async function networkState(daemon: Daemon): Promise<'offline' | 'online'> {
  const body = await readRecord(await daemon.call('GET', '/server'));
  if (typeof body.isLoggedIn !== 'boolean') throw clientError('unavailable:bad-response', 'the answer was not what slskd sends');
  return body.isLoggedIn ? 'online' : 'offline';
}

function isPositive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

async function startSearch(daemon: Daemon, words: string, terms: SearchTerms & { readonly timeoutMs: number }): Promise<{ readonly id: string }> {
  if (words.trim() === '' || MALFORMED_TEXT.test(words)) throw clientError('invalid:text');
  if (terms.username === '') throw clientError('invalid:username');
  if (!isPositive(terms.timeoutMs)) throw clientError('invalid:timeout');
  if (!isPositive(terms.limit)) throw clientError('invalid:limit');
  const id = uuid();
  const searchTimeout = Math.min(Math.max(terms.timeoutMs, SMALLEST_TIMEOUT_MS), LARGEST_TIMEOUT_MS);
  // slskd only searches the whole network. A search for one peer is that search with the other peers' answers left out,
  // so the daemon's own limits stay at their defaults: a limit of ours would fill up with answers nobody asked for.
  const limits = terms.username === undefined ? { responseLimit: terms.limit, fileLimit: terms.limit } : {};
  const response = await daemon.call('POST', '/searches', JSON.stringify({ id, searchText: words, searchTimeout, ...limits }));
  if (!response.ok) {
    // An offline daemon refuses with 409 yet keeps the search as an errored record; take it back so that "rejected, nothing changed" is true.
    await daemon.call('DELETE', `/searches/${id}`).catch(() => undefined);
    return refuse(response);
  }
  if ((await readRecord(response)).id !== id) throw clientError('unavailable:bad-response', 'the answer was not the search that was started');
  daemon.searches.set(id, { username: terms.username, limit: terms.limit });
  return { id };
}

/** slskd stores a search's answers when the search ends, so `files` stays empty until `complete` is true. */
async function searchResults(daemon: Daemon, id: string): Promise<SoulseekClientSearch> {
  const body = await readRecord(await daemon.call('GET', `/searches/${segment(id, 'id')}?includeResponses=true`));
  if (typeof body.isComplete !== 'boolean') throw clientError('unavailable:bad-response', 'the answer was not a search');
  const terms = daemon.searches.get(id);
  const files = records(body.responses).flatMap((response) => responseFiles(response, terms?.username));
  return { complete: body.isComplete, files: terms === undefined ? files : files.slice(0, terms.limit) };
}

async function stopSearch(daemon: Daemon, id: string): Promise<void> {
  const response = await daemon.call('PUT', `/searches/${segment(id, 'id')}`);
  if (!response.ok) await refuse(response);
}

async function deleteSearch(daemon: Daemon, id: string): Promise<void> {
  const response = await daemon.call('DELETE', `/searches/${segment(id, 'id')}`);
  daemon.searches.delete(id);
  // A search the daemon no longer has is already forgotten.
  if (!response.ok && response.status !== 404) await refuse(response);
}

async function browse(daemon: Daemon, username: string): Promise<readonly SoulseekClientFile[]> {
  const body = await readRecord(await daemon.call('GET', `/users/${segment(username, 'username')}/browse`), true);
  const open = records(body.directories);
  const locked = records(body.lockedDirectories);
  const separator = separatorOf([...open, ...locked]);
  return [
    ...open.flatMap((directory) => directoryFiles(username, directory, separator, false)),
    ...locked.flatMap((directory) => directoryFiles(username, directory, separator, true)),
  ];
}

async function findDownload(daemon: Daemon, username: string, path: string): Promise<Json | undefined> {
  const response = await daemon.call('GET', `/transfers/downloads/${segment(username, 'username')}`);
  if (response.status === 404) return undefined;
  const body = await readRecord(response);
  return records(body.directories)
    .flatMap((directory) => records(directory.files))
    .find((file) => file.filename === path);
}

function isLive(transfer: Json): boolean {
  return !String(transfer.state).includes('Completed');
}

async function download(daemon: Daemon, file: Pick<SoulseekClientFile, 'username' | 'path' | 'size'>): Promise<{ readonly id: string }> {
  const user = segment(file.username, 'username');
  if (file.path === '' || MALFORMED_TEXT.test(file.path)) throw clientError('invalid:path');
  if (!DECIMAL.test(file.size) || BigInt(file.size) > LARGEST_SIZE) throw clientError('invalid:size');
  // The size is written into the body as its own digits: as a JavaScript number it would be rounded past 2^53.
  const response = await daemon.call('POST', `/transfers/downloads/${user}`, `[{"filename":${JSON.stringify(file.path)},"size":${file.size}}]`);
  if (!response.ok) return refuse(response, true);
  // Current versions answer with what they queued; older ones with nothing, and any version only says "failed" for a file it is already fetching.
  const answer = await readClientJson(response).catch(() => undefined);
  const queued = isRecord(answer) ? records(answer.enqueued).find((transfer) => transfer.filename === file.path) : undefined;
  const declined = isRecord(answer) && list(answer.failed).length > 0;
  const known = queued ?? (await findDownload(daemon, file.username, file.path).catch(() => undefined));
  const id = known !== undefined && (queued !== undefined || !declined || isLive(known)) ? text(known.id) : undefined;
  if (id !== undefined) return { id };
  throw declined ? clientError('unavailable:rejected', 'the daemon did not queue the file') : clientError('unavailable:outcome-unknown');
}

async function transfer(daemon: Daemon, username: string, id: string): Promise<SoulseekClientTransfer | undefined> {
  const response = await daemon.call('GET', `/transfers/downloads/${segment(username, 'username')}/${segment(id, 'id')}`);
  // 400 is slskd's answer to an id that is not one of its own, which it therefore cannot have.
  if (response.status === 404 || response.status === 400) return undefined;
  const found = toTransfer(await readRecord(response));
  // slskd looks a transfer up by id alone; one that belongs to another peer is not the one asked for.
  return found.username === username ? found : undefined;
}

async function cancel(daemon: Daemon, username: string, id: string, remove: boolean): Promise<void> {
  const response = await daemon.call('DELETE', `/transfers/downloads/${segment(username, 'username')}/${segment(id, 'id')}?remove=${remove}`);
  if (response.status === 400) throw clientError('unavailable:not-found');
  if (!response.ok) await refuse(response);
}

/**
 * Drives a slskd daemon through its REST API (`/api/v0`). With `endpoint.apiKey` every
 * request carries the key; with a name and password the adapter signs in once and
 * carries the session token, signing in again when the daemon stops accepting it.
 *
 * What slskd cannot do shows in the results: it has no search aimed at one peer, so
 * `username` on a search leaves the other peers' answers out of a network search; and
 * it keeps a search's answers until the search ends, so `files` is empty before
 * `complete`. A peer's file whose path or size cannot be represented is left out.
 *
 * @param options - Where the daemon answers, the key or the name and password it asks for, and optionally `fetch` and a time limit.
 * @returns The daemon as a {@link SoulseekClient}.
 * @example
 * ```ts
 * const slskd = createSlskdClient({ endpoint: { url: 'http://localhost:5030', apiKey } });
 * if ((await slskd.state()) === 'online') {
 *   const { id } = await slskd.startSearch('field recording', { timeoutMs: 15_000, limit: 500 });
 *   const { complete, files } = await slskd.searchResults(id);
 * }
 * ```
 */
export function createSlskdClient(options: ClientOptions): SoulseekClient {
  const daemon = connect(options);
  return {
    probe: () => probe(daemon),
    state: () => networkState(daemon),
    startSearch: (words, terms) => startSearch(daemon, words, { username: terms.username, limit: terms.limit, timeoutMs: terms.timeoutMs }),
    searchResults: (id) => searchResults(daemon, id),
    stopSearch: (id) => stopSearch(daemon, id),
    deleteSearch: (id) => deleteSearch(daemon, id),
    browse: (username) => browse(daemon, username),
    download: (file) => download(daemon, file),
    transfer: (username, id) => transfer(daemon, username, id),
    cancel: (username, id, remove) => cancel(daemon, username, id, remove),
  };
}
