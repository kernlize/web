import type { SoulseekClient, SoulseekClientFile, SoulseekClientSearch } from '@kernlize/bridges';
import type { SoulseekErrorCode, SoulseekFailure, SoulseekFile, SoulseekQuery, SoulseekQueryKind, SoulseekQueryPage, SoulseekQueryReason, SoulseekQueryState, SoulseekTransferState } from '@napplet/core';

/** The runtime limits `soulseek.info` reports; fixed for the service's life. */
export interface SoulseekLimits {
  readonly maxQueries: number;
  readonly maxTransfers: number;
  readonly maxResults: number;
  readonly maxPageSize: number;
  readonly maxReadBytes: number;
  readonly maxTextBytes: number;
  readonly queryTimeoutMs: number;
  readonly pollIntervalMs: number;
}

/** A NAP-SOULSEEK failure on its way to the `error` of a `.result` envelope. */
export class SoulseekFault extends Error {
  readonly code: SoulseekErrorCode;

  /**
   * @param code - The NAP-SOULSEEK error code.
   * @param message - Plain words for the applet; never an address, a credential or a path.
   * @example
   * ```ts
   * throw new SoulseekFault('not_found', 'Query handle is unavailable');
   * ```
   */
  constructor(code: SoulseekErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Something whose operations run one after another. */
export interface SoulseekLane {
  tail: Promise<unknown>;
}

/**
 * The connection a query or transfer was admitted to. Its routing key is kept too, so work
 * started at one address is never carried on at the new address of the same connection.
 */
export interface SoulseekRoute {
  readonly id: string;
  readonly routingKey: string;
}

/** What a removed or locked connection's work fails with. */
export const SOULSEEK_GONE = 'That sharing program is no longer set up';

/** What the daemon holds for one search, bound to the connection that started it. */
export interface SoulseekQueryDaemon {
  read(): Promise<SoulseekClientSearch>;
  /** Never rejects: stopping is best effort. */
  stop(): Promise<void>;
  /** Never rejects: stops, then deletes the search in the daemon. */
  forget(): Promise<void>;
}

/** One query a window holds. */
export interface SoulseekQueryRecord extends SoulseekLane {
  readonly id: string;
  readonly kind: SoulseekQueryKind;
  /** Where the query was made; its files are downloaded from there too. */
  readonly route: SoulseekRoute;
  /** Undefined for a browse, which is one answer and not a search the daemon keeps. */
  readonly daemon: SoulseekQueryDaemon | undefined;
  readonly files: SoulseekFile[];
  readonly keys: Set<string>;
  readonly deadline: number;
  state: SoulseekQueryState;
  ending: { reason?: SoulseekQueryReason; error?: SoulseekFailure };
  polledAt: number;
  released: boolean;
}

/** One transfer a window holds. */
export interface SoulseekTransferRecord extends SoulseekLane {
  readonly id: string;
  readonly file: SoulseekFile;
  /** The connection that admitted it; a transfer never moves to another one. */
  readonly route: SoulseekRoute;
  daemonId: string;
  /** Whether the daemon still holds an unfinished record kernl put there. */
  inDaemon: boolean;
  state: SoulseekTransferState;
  received: string;
  progress: { queuePosition?: number; bytesPerSecond?: number };
  ending: { error?: SoulseekFailure };
  polledAt: number;
  released: boolean;
}

/** Everything one window holds; nothing in it is reachable from another window. */
export interface SoulseekSession {
  closed: boolean;
  approved: boolean;
  asking: Promise<boolean> | undefined;
  readonly seen: Set<string>;
  readonly admissions: SoulseekLane;
  readonly queries: Map<string, SoulseekQueryRecord>;
  readonly files: Map<string, { readonly file: SoulseekFile; readonly query: SoulseekQueryRecord }>;
  readonly transfers: Map<string, SoulseekTransferRecord>;
  readonly byFile: Map<string, SoulseekTransferRecord>;
}

/** The window a request came from, and what that window holds. */
export interface SoulseekCall {
  readonly windowId: string;
  readonly session: SoulseekSession;
}

/** What the query and transfer halves of the service share. */
export interface SoulseekContext {
  readonly limits: SoulseekLimits;
  readonly now: () => number;
  /** Rejects `unavailable` unless this daemon is signed in to its network. */
  readonly online: (client: SoulseekClient) => Promise<void>;
  /**
   * A daemon once it is known to be signed in: the one `route` names, or the person's default
   * for new work. Rejects `unavailable` when it is not signed in or none is set up, and
   * `backend_error` when the named connection is gone.
   */
  readonly reach: (route?: SoulseekRoute) => Promise<{ readonly route: SoulseekRoute; readonly client: SoulseekClient }>;
  /** The live client of a route; undefined once the connection was removed, is locked or has a new address. */
  readonly clientOf: (route: SoulseekRoute) => SoulseekClient | undefined;
  /** Resolves once the person has said yes for this window; rejects `denied` on a no. */
  readonly consent: (windowId: string, session: SoulseekSession) => Promise<void>;
}

const ENCODER = new TextEncoder();
const LONE_SURROGATE = /\p{Surrogate}/u;
const BYTE_COUNT = /^(0|[1-9]\d{0,19})$/;
const MAX_BYTE_COUNT = 18446744073709551615n;
const COLLECTION_FAILED = 'The sharing program stopped answering while results were gathered';

/**
 * Swallows a rejection from work that is best effort, such as tidying up in the daemon.
 *
 * @returns Nothing.
 * @example
 * ```ts
 * await client.stopSearch(id).catch(ignore);
 * ```
 */
export function ignore(): undefined {
  return undefined;
}

/**
 * Runs work on a route's daemon, or rejects `backend_error` when that connection is gone.
 *
 * @param context - The service's shared parts.
 * @param route - The connection the work belongs to.
 * @param work - What to ask its daemon.
 * @returns What the work returns.
 * @example
 * ```ts
 * await onRoute(context, record.route, (client) => client.transfer(username, id));
 * ```
 */
export function onRoute<T>(context: SoulseekContext, route: SoulseekRoute, work: (client: SoulseekClient) => Promise<T>): Promise<T> {
  const client = context.clientOf(route);
  return client ? work(client) : Promise.reject(new SoulseekFault('backend_error', SOULSEEK_GONE));
}

/**
 * Issues a handle: opaque, never reused, and never one of the daemon's own ids.
 *
 * @param prefix - One letter naming what the handle is for.
 * @returns The handle, 38 bytes long.
 * @example
 * ```ts
 * issueSoulseekHandle('q'); // 'q-3f0c…'
 * ```
 */
export function issueSoulseekHandle(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Runs work after everything already queued on a lane, whether that succeeded or not.
 *
 * @param lane - The session or record whose operations must not interleave.
 * @param work - What to run.
 * @returns What the work returns.
 * @example
 * ```ts
 * await serial(session.admissions, () => client.startSearch('rain', bounds));
 * ```
 */
export function serial<T>(lane: SoulseekLane, work: () => T | Promise<T>): Promise<T> {
  const run = lane.tail.then(work);
  lane.tail = run.catch(ignore);
  return run;
}

/**
 * Stops a pending request whose window ended (`revoked`) or whose object was released (`cancelled`).
 *
 * @param session - The window's session.
 * @param released - Whether the object the request works on was released meanwhile.
 * @returns Nothing when the request may go on.
 * @example
 * ```ts
 * alive(session, query.released);
 * ```
 */
export function alive(session: SoulseekSession, released = false): void {
  if (session.closed) throw new SoulseekFault('revoked', 'This window may no longer use the sharing program');
  if (released) throw new SoulseekFault('cancelled', 'This was released while the request was pending');
}

/**
 * Runs one operation on a query or transfer in its turn, and drops its result when the
 * object was released or the window ended while it ran.
 *
 * @param session - The window's session.
 * @param record - The query or transfer.
 * @param work - The operation.
 * @returns What the operation returns.
 * @example
 * ```ts
 * await within(session, transfer, () => refresh(transfer));
 * ```
 */
export function within<T>(session: SoulseekSession, record: SoulseekLane & { readonly released: boolean }, work: () => T | Promise<T>): Promise<T> {
  return serial(record, async () => {
    alive(session, record.released);
    const value = await work();
    alive(session, record.released);
    return value;
  });
}

/**
 * Admits new network work for a window: the daemon must be online and the person must
 * have said yes, and admissions for one window run one at a time so limits hold exactly.
 * The lane is taken only after the person answered (NAP-SOULSEEK, Transfer lifetime).
 *
 * @param context - The service's shared parts.
 * @param call - The window asking.
 * @param work - The admission, given the daemon it was admitted to and its route.
 * @param route - The connection the work must go to; the person's default when left out.
 * @returns What the admission returns.
 * @example
 * ```ts
 * await admitSoulseekWork(context, call, (client) => client.download(source), query.route);
 * ```
 */
export async function admitSoulseekWork<T>(context: SoulseekContext, call: SoulseekCall, work: (client: SoulseekClient, route: SoulseekRoute) => T | Promise<T>, route?: SoulseekRoute): Promise<T> {
  const reached = await context.reach(route);
  await context.consent(call.windowId, call.session);
  return serial(call.session.admissions, () => {
    alive(call.session);
    return work(reached.client, reached.route);
  });
}

function invalid(message: string): SoulseekFault {
  return new SoulseekFault('invalid_request', message);
}

/**
 * Rejects a request carrying a field its operation does not define.
 *
 * @param fields - The request's parameters.
 * @param names - The fields the operation defines.
 * @returns Nothing when every field is known.
 * @example
 * ```ts
 * onlyFields({ queryId: 'q-1', extra: 1 }, ['queryId']); // throws invalid_request
 * ```
 */
export function onlyFields(fields: object, names: readonly string[]): void {
  const unknown = Object.keys(fields).find((key) => !names.includes(key));
  if (unknown !== undefined) throw invalid('The request has a field this operation does not define');
}

function isText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value !== '' && !value.includes('\0') && !LONE_SURROGATE.test(value) && ENCODER.encode(value).length <= maxBytes;
}

/**
 * Reads a text parameter: nonempty, valid Unicode without U+0000, within the byte bound.
 *
 * @param value - What the applet sent.
 * @param name - The field's name, for the message.
 * @param maxBytes - `maxTextBytes`.
 * @returns The text.
 * @example
 * ```ts
 * textOf('q-1', 'queryId', 1024); // 'q-1'
 * ```
 */
export function textOf(value: unknown, name: string, maxBytes: number): string {
  if (!isText(value, maxBytes)) throw invalid(`${name} must be nonempty text of at most ${maxBytes} bytes, without U+0000`);
  return value;
}

/**
 * Reads an integer parameter within a range.
 *
 * @param value - What the applet sent.
 * @param name - The field's name, for the message.
 * @param range - The smallest and largest value allowed.
 * @returns The integer.
 * @example
 * ```ts
 * integerOf(25, 'limit', [1, 100]); // 25
 * ```
 */
export function integerOf(value: unknown, name: string, range: readonly [number, number]): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < range[0] || value > range[1]) throw invalid(`${name} must be an integer from ${range[0]} to ${range[1]}`);
  return value;
}

function isByteCount(value: unknown): value is string {
  return typeof value === 'string' && BYTE_COUNT.test(value) && BigInt(value) <= MAX_BYTE_COUNT;
}

/**
 * Reads a byte count or offset: canonical unsigned decimal text up to 2^64 - 1.
 *
 * @param value - What the applet sent.
 * @param name - The field's name, for the message.
 * @returns The text, unchanged.
 * @example
 * ```ts
 * byteCountOf('00', 'offset'); // throws invalid_request
 * ```
 */
export function byteCountOf(value: unknown, name: string): string {
  if (!isByteCount(value)) throw invalid(`${name} is not canonical decimal text`);
  return value;
}

const isCount = (value: unknown, least: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= least;

/**
 * Turns one entry a peer sent into what an applet may see, or nothing when the entry
 * cannot be represented. Optional hints a peer got wrong are dropped, not the entry.
 *
 * @param raw - The entry as the daemon reported it.
 * @param maxBytes - `maxTextBytes`; a name or path longer than this is not retained.
 * @returns The file without a handle, or undefined.
 * @example
 * ```ts
 * describeSoulseekFile({ username: 'ann', path: 'a\\b.flac', size: '3', locked: false }, 1024);
 * ```
 */
export function describeSoulseekFile(raw: SoulseekClientFile, maxBytes: number): Omit<SoulseekFile, 'fileId'> | undefined {
  if (!isText(raw.username, maxBytes) || !isText(raw.path, maxBytes) || !isByteCount(raw.size) || typeof raw.locked !== 'boolean') return undefined;
  return {
    username: raw.username,
    path: raw.path,
    size: raw.size,
    locked: raw.locked,
    ...(isText(raw.extension, maxBytes) ? { extension: raw.extension } : {}),
    ...(isCount(raw.bitrateKbps, 1) ? { bitrateKbps: raw.bitrateKbps } : {}),
    ...(isCount(raw.durationSeconds, 0) ? { durationSeconds: raw.durationSeconds } : {}),
    ...(isCount(raw.sampleRateHz, 1) ? { sampleRateHz: raw.sampleRateHz } : {}),
    ...(isCount(raw.bitDepth, 1) ? { bitDepth: raw.bitDepth } : {}),
  };
}

function browseFailure(error: Error): SoulseekFailure {
  if (error.message.startsWith('unavailable:peer-unavailable')) return { code: 'peer_unavailable', message: 'That person could not be reached' };
  if (error.message.startsWith('denied:peer')) return { code: 'peer_denied', message: 'That person does not share their list' };
  return { code: 'backend_error', message: 'The sharing program could not fetch the list' };
}

/** The query operations of the service, plus what teardown needs. */
export interface SoulseekQueries {
  search(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekQuery>;
  browse(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekQuery>;
  results(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekQueryPage>;
  stop(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekQuery>;
  /** Resolves false when the window holds no such query. */
  release(session: SoulseekSession, handle: string): Promise<boolean>;
  /** Removes the query and its file handles now, then stops and deletes it in the daemon. */
  discard(session: SoulseekSession, query: SoulseekQueryRecord): Promise<void>;
}

function snapshotOf(limits: SoulseekLimits, query: SoulseekQueryRecord): SoulseekQuery {
  return {
    queryId: query.id,
    kind: query.kind,
    state: query.state,
    count: query.files.length,
    maxResults: limits.maxResults,
    maxPageSize: limits.maxPageSize,
    timeoutMs: limits.queryTimeoutMs,
    ...query.ending,
  };
}

function finish(query: SoulseekQueryRecord, state: SoulseekQueryState, ending: SoulseekQueryRecord['ending']): void {
  query.state = state;
  query.ending = ending;
}

/** A browse has one answer to wait for; past its deadline it has failed, whenever that is noticed. */
function expire(context: SoulseekContext, query: SoulseekQueryRecord): void {
  if (query.state === 'collecting' && !query.daemon && context.now() >= query.deadline) finish(query, 'failed', { error: { code: 'timeout', message: 'That person did not send their list in time' } });
}

function retain(context: SoulseekContext, session: SoulseekSession, query: SoulseekQueryRecord, incoming: readonly SoulseekClientFile[]): { lost: boolean; overflow: boolean } {
  const { maxResults, maxTextBytes } = context.limits;
  let lost = false;
  for (const raw of incoming) {
    const file = describeSoulseekFile(raw, maxTextBytes);
    const key = JSON.stringify([raw.username, raw.path, raw.size]);
    if (!file) lost = true;
    else if (!query.keys.has(key)) {
      if (query.files.length >= maxResults) return { lost, overflow: true };
      const entry = { fileId: issueSoulseekHandle('f'), ...file };
      query.keys.add(key);
      query.files.push(entry);
      session.files.set(entry.fileId, { file: entry, query });
    }
  }
  return { lost, overflow: false };
}

/** Reads what a search has found since the last look, when a look is due, and ends the search when its rules say so. */
async function gather(context: SoulseekContext, session: SoulseekSession, query: SoulseekQueryRecord): Promise<void> {
  const { limits } = context;
  expire(context, query);
  const { daemon } = query;
  const now = context.now();
  const due = now >= query.deadline;
  if (query.state !== 'collecting' || !daemon || (!due && now - query.polledAt < limits.pollIntervalMs)) return;
  query.polledAt = now;
  if (!context.clientOf(query.route)) return finish(query, 'failed', { error: { code: 'backend_error', message: SOULSEEK_GONE } });
  const found = await daemon.read().catch(ignore);
  if (query.state !== 'collecting') return;
  if (!found) return finish(query, 'failed', { error: { code: 'backend_error', message: COLLECTION_FAILED } });
  retain(context, session, query, found.files);
  if (query.files.length >= limits.maxResults) finish(query, 'complete', { reason: 'limit' });
  else if (found.complete || due) finish(query, 'complete', { reason: 'deadline' });
  else return;
  if (!found.complete) await daemon.stop();
}

function settle(context: SoulseekContext, session: SoulseekSession, query: SoulseekQueryRecord, listing: readonly SoulseekClientFile[]): void {
  const { lost, overflow } = retain(context, session, query, listing);
  if (lost) finish(query, 'failed', { error: { code: 'backend_error', message: 'Part of the list could not be read' } });
  else finish(query, 'complete', { reason: overflow ? 'limit' : 'peer_complete' });
}

function discard(session: SoulseekSession, query: SoulseekQueryRecord): Promise<void> {
  session.queries.delete(query.id);
  for (const file of query.files) session.files.delete(file.fileId);
  query.released = true;
  // A terminal state is what makes a late answer from the daemon or a peer get discarded.
  if (query.state === 'collecting') finish(query, 'stopped', { reason: 'cancelled' });
  return serial(query, async () => {
    await query.daemon?.forget();
  });
}

/**
 * The query half of the `soulseek` service: searches and browses, gathered lazily as
 * the applet polls, each bound to the window that started it.
 *
 * @param context - Limits, clock, the daemon and the person's consent.
 * @returns The `search`, `browse`, `results` and `stop` operations, and release.
 * @example
 * ```ts
 * const queries = createSoulseekQueries(context);
 * const query = await queries.search(call, { request: { text: 'field recording' } });
 * ```
 */
export function createSoulseekQueries(context: SoulseekContext): SoulseekQueries {
  const { limits } = context;
  const snapshot = (query: SoulseekQueryRecord): SoulseekQuery => snapshotOf(limits, query);
  const room = (session: SoulseekSession): void => {
    if (session.queries.size >= limits.maxQueries) throw new SoulseekFault('limit_exceeded', `This window already holds ${limits.maxQueries} searches; release one first`);
  };
  const open = (session: SoulseekSession, kind: SoulseekQueryKind, route: SoulseekRoute, daemon: SoulseekQueryDaemon | undefined): SoulseekQueryRecord => {
    const query: SoulseekQueryRecord = { id: issueSoulseekHandle('q'), kind, route, daemon, files: [], keys: new Set(), deadline: context.now() + limits.queryTimeoutMs, state: 'collecting', ending: {}, polledAt: context.now(), released: false, tail: Promise.resolve() };
    session.queries.set(query.id, query);
    return query;
  };
  const owned = (session: SoulseekSession, fields: Record<string, unknown>): SoulseekQueryRecord => {
    const query = session.queries.get(textOf(fields.queryId, 'queryId', limits.maxTextBytes));
    if (!query) throw new SoulseekFault('not_found', 'Query handle is unavailable');
    return query;
  };
  return {
    async search(call, fields) {
      onlyFields(fields, ['request']);
      const { request } = fields;
      if (typeof request !== 'object' || request === null) throw invalid('request must be a record');
      onlyFields(request, ['text', 'username']);
      const { text, username } = request as { text?: unknown; username?: unknown };
      if (textOf(text, 'text', limits.maxTextBytes).trim() === '') throw invalid('text must have a character that is not white space');
      const peer = username === undefined ? {} : { username: textOf(username, 'username', limits.maxTextBytes) };
      return admitSoulseekWork(context, call, async (client, route) => {
        const { session } = call;
        room(session);
        const { id } = await client.startSearch(text as string, { ...peer, timeoutMs: limits.queryTimeoutMs, limit: limits.maxResults });
        // Every later look goes to the connection by its route, so one removed meanwhile is never asked.
        const stop = (): Promise<void> => onRoute(context, route, (daemon) => daemon.stopSearch(id)).catch(ignore);
        const daemon: SoulseekQueryDaemon = {
          read: () => onRoute(context, route, (daemon) => daemon.searchResults(id)),
          stop,
          forget: () => stop().then(() => onRoute(context, route, (daemon) => daemon.deleteSearch(id))).catch(ignore),
        };
        if (session.closed) await daemon.forget();
        alive(session);
        return snapshot(open(session, 'search', route, daemon));
      });
    },
    async browse(call, fields) {
      onlyFields(fields, ['username']);
      const username = textOf(fields.username, 'username', limits.maxTextBytes);
      return admitSoulseekWork(context, call, (client, route) => {
        const { session } = call;
        room(session);
        const query = open(session, 'browse', route, undefined);
        const land = (apply: () => void): void => {
          expire(context, query);
          if (query.state === 'collecting') apply();
        };
        void client.browse(username).then(
          (listing) => land(() => settle(context, session, query, listing)),
          (error: Error) => land(() => finish(query, 'failed', { error: browseFailure(error) })),
        );
        return snapshot(query);
      });
    },
    async results({ session }, fields) {
      onlyFields(fields, ['queryId', 'after', 'limit']);
      const after = fields.after === undefined ? 0 : integerOf(fields.after, 'after', [0, Number.MAX_SAFE_INTEGER]);
      const limit = fields.limit === undefined ? limits.maxPageSize : integerOf(fields.limit, 'limit', [1, limits.maxPageSize]);
      const query = owned(session, fields);
      return within(session, query, async () => {
        await gather(context, session, query);
        if (after > query.files.length) throw invalid('after is past the last result');
        const files = query.files.slice(after, after + limit);
        return { query: snapshot(query), files, next: after + files.length };
      });
    },
    async stop({ session }, fields) {
      onlyFields(fields, ['queryId']);
      const query = owned(session, fields);
      return within(session, query, async () => {
        await gather(context, session, query);
        if (query.state === 'collecting') {
          finish(query, 'stopped', { reason: 'cancelled' });
          await query.daemon?.stop();
        }
        return snapshot(query);
      });
    },
    async release(session, handle) {
      const query = session.queries.get(handle);
      if (query) await discard(session, query);
      return query !== undefined;
    },
    discard,
  };
}
