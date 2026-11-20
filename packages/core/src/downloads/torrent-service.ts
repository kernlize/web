import type { ServiceRuntimeContext } from '@kehto/runtime';
import type { TorrentClient, TorrentClientJob } from '@kernlize/bridges';
import type { ConnectionRouting, RoutedClient } from './connections.js';
import type { NappletMessage, TorrentJobStatus } from '@napplet/core';
import {
  createTorrentJobs,
  describeTorrentAdd,
  describeTorrentDelete,
  torrentFileStatus,
  torrentFinished,
  torrentJobSettings,
  torrentJobStatus,
  torrentJobSummary,
  torrentMetadata,
  type TorrentJobRecord,
  type TorrentJobs,
} from './torrent-jobs.js';
import {
  planTorrentAdd,
  planTorrentFilter,
  planTorrentSelection,
  planTorrentUpdate,
  TORRENT_CAPABILITIES,
  TORRENT_PUSHES,
  TORRENT_REQUESTS,
  TorrentFailure,
  torrentFailureFields,
  torrentFailureFrom,
  torrentText,
  wantsTorrentDataDeleted,
  type TorrentAddPlan,
} from './torrent-wire.js';
import type { DownloadService, DownloadServiceDeps } from './types.js';

/** What the torrent service needs from the shell. */
export interface TorrentServiceOptions extends DownloadServiceDeps {
  /** The person's torrent connections, read on every request: new torrents go to one, and each job stays on its own. */
  readonly connections: ConnectionRouting<TorrentClient>;
  /** How often jobs with a live window are refreshed and pushed; 2000 ms by default. */
  readonly pollMs?: number;
}

/** A NIP-5D envelope with its payload fields, which kehto's own type leaves to each domain. */
type Envelope = NappletMessage & Record<string, unknown>;

/** One request on its way through: who sent it, for which applet, and what it says. */
interface Call {
  readonly windowId: string;
  readonly applet: string;
  readonly message: Readonly<Record<string, unknown>>;
}

/** Everything one service instance holds. */
interface Engine {
  readonly options: TorrentServiceOptions;
  readonly jobs: TorrentJobs;
  /** Live windows that have spoken, each with its applet. */
  readonly windows: Map<string, string>;
  readonly runtimes: ServiceRuntimeContext[];
  /** The end of the queue every call to the program waits in. */
  tail: Promise<unknown>;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** The connections that could not be reached at the last refresh, whose windows were told. */
  readonly unreachable: Set<string>;
  disposed: boolean;
}

const NOT_SET_UP = 'No torrent program is set up.';
const NO_LONGER = 'That torrent program is no longer set up.';
const GONE = 'Your torrent program no longer has this torrent.';

/** Runs work after everything queued before it, whether that succeeded or not. */
function serial<T>(engine: Engine, work: () => Promise<T>): Promise<T> {
  const run = engine.tail.then(work);
  engine.tail = run.catch(() => undefined);
  return run;
}

/** The connection a job's torrent was handed to, while it can still serve. */
const routeOf = (engine: Engine, record: TorrentJobRecord): RoutedClient<TorrentClient> | undefined => engine.options.connections.byId(record.connection);

/** The client of a job's own connection; `source-unavailable` once the person removed it or it is locked. */
function clientOf(engine: Engine, record: TorrentJobRecord): TorrentClient {
  const routed = routeOf(engine, record);
  if (!routed) throw new TorrentFailure('source-unavailable', NO_LONGER);
  return routed.client;
}

/** A session job speaks to its own window; a persistent job to every live window of its applet. */
function recipients(engine: Engine, record: TorrentJobRecord): readonly string[] {
  if (record.windowId !== undefined) return [record.windowId];
  return [...engine.windows].filter(([, applet]) => applet === record.applet).map(([windowId]) => windowId);
}

function push(engine: Engine, record: TorrentJobRecord, message: Envelope): void {
  for (const windowId of recipients(engine, record)) for (const runtime of engine.runtimes) runtime.sendToEligibleNapplet(windowId, message);
}

/** The other jobs holding the same torrent on the same connection; the same torrent elsewhere is another program's copy. */
function sharers(engine: Engine, record: TorrentJobRecord): readonly TorrentJobRecord[] {
  return engine.jobs.all().filter((other) => other !== record && other.connection === record.connection && other.infoHash === record.infoHash);
}

function visible(engine: Engine, call: Call, jobId: string): TorrentJobRecord {
  const record = engine.jobs.visible(call.applet, call.windowId).find((candidate) => candidate.jobId === jobId);
  if (!record) throw new TorrentFailure('job-not-found');
  return record;
}

/**
 * Brings a job in line with what the program reports: ends it when the torrent is gone,
 * takes a limit changed in the program as a new revision, and pauses a finished
 * torrent that no owner wants shared.
 */
async function settle(engine: Engine, record: TorrentJobRecord, job: TorrentClientJob | undefined, client: TorrentClient): Promise<TorrentClientJob | undefined> {
  if (record.failed || !job) {
    record.failed = true;
    return undefined;
  }
  if (job.downloadLimit !== record.downloadLimit || job.uploadLimit !== record.uploadLimit) {
    Object.assign(record, { downloadLimit: job.downloadLimit, uploadLimit: job.uploadLimit, revision: record.revision + 1 });
    engine.jobs.touch(record);
  }
  const wanted = [record, ...sharers(engine, record)].some((owner) => !owner.failed && owner.mode === 'download-and-seed');
  if (job.state === 'seeding' && !wanted) await client.pause(record.infoHash);
  return job;
}

async function current(engine: Engine, record: TorrentJobRecord): Promise<TorrentClientJob> {
  const client = clientOf(engine, record);
  const job = await settle(engine, record, await client.get(record.infoHash), client);
  if (!job) throw new TorrentFailure('source-unavailable', GONE);
  return job;
}

async function view(engine: Engine, record: TorrentJobRecord): Promise<TorrentJobStatus> {
  return torrentJobStatus(record, await current(engine, record));
}

/** Tells a job's windows what changed since they were last told: its state, or else its numbers. */
function report(engine: Engine, record: TorrentJobRecord, job: TorrentClientJob | undefined): void {
  const jobId = record.jobId;
  if (!job) {
    push(engine, record, { type: 'torrent.error', jobId, error: 'source-unavailable', reason: GONE });
    push(engine, record, { type: 'torrent.state', jobId, state: 'error' });
    record.idle = true;
    return;
  }
  const status = torrentJobStatus(record, job);
  const numbers = JSON.stringify({ ...status, state: undefined });
  if (status.state !== record.lastState) push(engine, record, { type: 'torrent.state', jobId, state: status.state, status });
  else if (numbers !== record.lastNumbers) push(engine, record, { type: 'torrent.progress', jobId, status });
  // The program's own words can hold a tracker address with a passkey in it, so they are not passed on.
  if (status.state === 'error' && record.lastState !== 'error') push(engine, record, { type: 'torrent.error', jobId, error: 'network-error', reason: 'Your torrent program reported a problem with this torrent.' });
  Object.assign(record, { lastState: status.state, lastNumbers: numbers, idle: status.state === 'complete' || status.state === 'error' });
}

/**
 * Tells a job's windows its connection is gone. The job is not ended: a locked connection
 * signed in to again serves it once more, so it is only left unwatched until asked about.
 */
function orphan(engine: Engine, record: TorrentJobRecord): void {
  push(engine, record, { type: 'torrent.error', jobId: record.jobId, error: 'source-unavailable', reason: NO_LONGER });
  push(engine, record, { type: 'torrent.state', jobId: record.jobId, state: 'error' });
  Object.assign(record, { lastState: 'error', idle: true });
}

function watched(engine: Engine): readonly TorrentJobRecord[] {
  return engine.jobs.all().filter((record) => !record.idle && recipients(engine, record).length > 0);
}

/** One reading of one connection for its watched jobs. An outage is told once per connection, not every tick. */
async function pollConnection(engine: Engine, id: string, records: readonly TorrentJobRecord[]): Promise<void> {
  const routed = engine.options.connections.byId(id);
  if (!routed) return records.forEach((record) => orphan(engine, record));
  try {
    const list = await routed.client.list();
    for (const record of records) report(engine, record, await settle(engine, record, list.find((job) => job.infoHash === record.infoHash), routed.client));
    engine.unreachable.delete(id);
  } catch (error) {
    const reason = torrentFailureFrom(error).reason as string;
    if (!engine.unreachable.has(id)) for (const record of records) push(engine, record, { type: 'torrent.error', jobId: record.jobId, error: 'network-error', reason });
    engine.unreachable.add(id);
  }
}

/** One `list()` per connection that has watched jobs. */
async function poll(engine: Engine): Promise<void> {
  const byConnection = new Map<string, TorrentJobRecord[]>();
  for (const record of watched(engine)) byConnection.set(record.connection, [...(byConnection.get(record.connection) ?? []), record]);
  for (const [id, records] of byConnection) await pollConnection(engine, id, records);
}

/** Keeps the one timer running only while some live window has a job that can still change. */
function arm(engine: Engine): void {
  if (engine.disposed || engine.timer !== undefined || watched(engine).length === 0) return;
  engine.timer = setTimeout(() => {
    engine.timer = undefined;
    void serial(engine, () => poll(engine)).then(() => arm(engine));
  }, engine.options.pollMs ?? 2000);
}

/** Runs one change or reading of a job the caller may see, in turn behind everything queued before it. */
function onJob<T>(engine: Engine, call: Call, jobId: unknown, act: (record: TorrentJobRecord, client: TorrentClient) => Promise<T>): Promise<T> {
  const id = torrentText(jobId);
  return serial(engine, async () => {
    const record = visible(engine, call, id);
    const client = clientOf(engine, record);
    record.idle = false;
    return act(record, client);
  });
}

function admit(engine: Engine, applet: string, plan: TorrentAddPlan): void {
  const owned = engine.jobs.owned(applet);
  if (owned.some((record) => record.jobId === plan.jobId || record.infoHash === plan.infoHash)) throw new TorrentFailure('job-conflict', 'This applet already has that job or that torrent.');
  if (owned.length >= (TORRENT_CAPABILITIES.maxActiveJobs as number)) throw new TorrentFailure('quota-exceeded');
}

/**
 * Hands the torrent to the program once the person has said yes. The job is written
 * down first. Limits are set while the torrent is still paused, so it never runs
 * unlimited first; if that fails it stays paused in the program and no job is kept.
 */
async function start(engine: Engine, call: Call, plan: TorrentAddPlan, connection: string): Promise<Record<string, unknown>> {
  if (engine.windows.get(call.windowId) !== call.applet) throw new TorrentFailure('policy-denied');
  admit(engine, call.applet, plan);
  // The person said yes to this connection; if it went meanwhile, the torrent goes nowhere else.
  const client = engine.options.connections.byId(connection)?.client;
  if (!client) throw new TorrentFailure('unsupported-transport', NO_LONGER);
  const { infoHash, mode, retention, title, downloadLimit, uploadLimit, startPaused } = plan;
  const state = startPaused ? 'paused' : 'queued';
  const record: TorrentJobRecord = {
    applet: call.applet,
    jobId: plan.jobId ?? `tor-${crypto.randomUUID()}`,
    infoHash, connection, retention, mode, downloadLimit, uploadLimit,
    revision: 0,
    paused: startPaused,
    failed: false,
    idle: false,
    lastState: state,
    ...(retention === 'session' ? { windowId: call.windowId } : {}),
    ...(title === undefined ? {} : { title }),
  };
  engine.jobs.add(record);
  try {
    const limited = downloadLimit > 0 || uploadLimit > 0;
    await client.add(plan.source, { paused: startPaused || limited });
    if (limited) await client.setLimits(infoHash, { downloadLimit, uploadLimit });
    if (limited && !startPaused) await client.resume(infoHash);
  } catch (error) {
    engine.jobs.drop(record);
    throw error;
  }
  return { ok: true, jobId: record.jobId, state };
}

/** Where a new torrent goes: the connection a job already holds it on, so it is never fetched twice, else the person's default. */
function target(engine: Engine, plan: TorrentAddPlan): RoutedClient<TorrentClient> {
  const holder = engine.jobs.all().find((record) => record.infoHash === plan.infoHash && routeOf(engine, record) !== undefined);
  const routed = (holder && routeOf(engine, holder)) ?? engine.options.connections.preferred();
  if (!routed) throw new TorrentFailure('unsupported-transport', NOT_SET_UP);
  return routed;
}

async function add(engine: Engine, call: Call): Promise<Record<string, unknown>> {
  const plan = await planTorrentAdd(call.message.request);
  const { connection } = target(engine, plan);
  admit(engine, call.applet, plan);
  if (!(await engine.options.ask(call.windowId, describeTorrentAdd(plan, connection.label)))) throw new TorrentFailure('user-denied');
  return serial(engine, () => start(engine, call, plan, connection.id));
}

/** Takes the torrent out of its program when no other job holds it there; resolves whether the program had it. */
async function takeOut(engine: Engine, record: TorrentJobRecord, deleteData: boolean): Promise<boolean> {
  const routed = routeOf(engine, record);
  if (!routed || sharers(engine, record).length > 0) return false;
  const job = await routed.client.get(record.infoHash);
  if (job) await routed.client.remove(record.infoHash, deleteData);
  return job !== undefined;
}

/**
 * A torrent another job still holds stays in the program with its data, whatever was
 * asked. Data is deleted only when the person said yes to this very removal. A job whose
 * connection is gone is only forgotten: kernl cannot remove anything from a program it no
 * longer knows, so nobody is asked about files.
 */
async function remove(engine: Engine, call: Call): Promise<Record<string, unknown>> {
  const jobId = torrentText(call.message.jobId);
  const wanted = wantsTorrentDataDeleted(call.message.options);
  const held = visible(engine, call, jobId);
  const asking = wanted && routeOf(engine, held) !== undefined && sharers(engine, held).length === 0;
  if (asking && !(await engine.options.ask(call.windowId, describeTorrentDelete(held)))) throw new TorrentFailure('user-denied');
  return serial(engine, async () => {
    const record = visible(engine, call, jobId);
    const removed = await takeOut(engine, record, asking);
    engine.jobs.drop(record);
    return { ok: true, jobId, deletedData: asking && removed };
  });
}

/** The files named are fetched and every other file is skipped; a name the torrent does not have refuses the whole request. */
function selectFiles(engine: Engine, call: Call): Promise<TorrentJobStatus> {
  const selection = planTorrentSelection(call.message.selection);
  return onJob(engine, call, call.message.jobId, async (record, client) => {
    const files = await client.files(record.infoHash);
    if (files.length === 0) throw new TorrentFailure('metadata-unavailable');
    const all = files.map((file) => file.index);
    const named = selection.paths.map((path) => files.find((file) => file.path === path)?.index ?? -1);
    const wanted = [...new Set([...selection.indexes, ...named])];
    if (wanted.some((index) => !all.includes(index))) throw new TorrentFailure('invalid-request');
    const skipped = all.filter((index) => !wanted.includes(index));
    await client.selectFiles(record.infoHash, wanted, { selected: true, ...(selection.priority === undefined ? {} : { priority: selection.priority }) });
    if (skipped.length > 0) await client.selectFiles(record.infoHash, skipped, { selected: false });
    return view(engine, record);
  });
}

/**
 * Limits go to the program; whether to keep sharing is kernl's own to remember. A
 * finished download asked to share starts at once unless the applet paused it; one
 * asked to stop sharing is paused at the next refresh.
 */
function update(engine: Engine, call: Call): Promise<Record<string, unknown>> {
  const plan = planTorrentUpdate(call.message.request);
  return onJob(engine, call, plan.jobId, async (record, client) => {
    const job = await current(engine, record);
    if (plan.expectedRevision !== record.revision) throw new TorrentFailure('revision-conflict', undefined, { settings: torrentJobSettings(record) });
    const downloadLimit = plan.downloadLimit ?? record.downloadLimit;
    const uploadLimit = plan.uploadLimit ?? record.uploadLimit;
    const mode = (plan.seedAfterComplete ?? record.mode === 'download-and-seed') ? 'download-and-seed' : 'download';
    const limitsChange = downloadLimit !== record.downloadLimit || uploadLimit !== record.uploadLimit;
    if (!limitsChange && mode === record.mode) return { ok: true, settings: torrentJobSettings(record) };
    if (limitsChange) await client.setLimits(record.infoHash, { downloadLimit, uploadLimit });
    const startsSharing = mode === 'download-and-seed' && record.mode === 'download' && torrentFinished(job) && !record.paused;
    if (startsSharing) await client.resume(record.infoHash);
    Object.assign(record, { downloadLimit, uploadLimit, mode, revision: record.revision + 1 });
    engine.jobs.touch(record);
    return { ok: true, settings: torrentJobSettings(record) };
  });
}

function setPaused(engine: Engine, call: Call, paused: boolean): Promise<TorrentJobStatus> {
  return onJob(engine, call, call.message.jobId, async (record, client) => {
    await (paused ? client.pause(record.infoHash) : client.resume(record.infoHash));
    record.paused = paused;
    engine.jobs.touch(record);
    return view(engine, record);
  });
}

/** A job's line, reading its connection's list once per request; a job whose connection is gone is listed in `error`. */
async function summarise(engine: Engine, record: TorrentJobRecord, lists: Map<string, Promise<readonly TorrentClientJob[]>>) {
  const routed = routeOf(engine, record);
  if (!routed) return torrentJobSummary(record, undefined);
  const reported = lists.get(record.connection) ?? routed.client.list();
  lists.set(record.connection, reported);
  return torrentJobSummary(record, await settle(engine, record, (await reported).find((job) => job.infoHash === record.infoHash), routed.client));
}

/** An applet with no jobs is answered without troubling any program. */
function list(engine: Engine, call: Call): Promise<unknown> {
  const filter = planTorrentFilter(call.message.filter);
  return serial(engine, async () => {
    const lists = new Map<string, Promise<readonly TorrentClientJob[]>>();
    const summaries = [];
    for (const record of engine.jobs.visible(call.applet, call.windowId)) summaries.push(await summarise(engine, record, lists));
    return summaries.filter((summary) => (filter.states ?? [summary.state]).includes(summary.state) && (filter.modes ?? [summary.mode]).includes(summary.mode));
  });
}

/** Nothing an applet can cancel is ever pending here, so there is never anything to stop. */
async function cancel(_engine: Engine, call: Call): Promise<Record<string, unknown>> {
  torrentText(call.message.requestId);
  return { ok: true, cancelled: false };
}

async function unsupported(): Promise<never> {
  throw new TorrentFailure('unsupported', 'kernl drives a torrent program and cannot reach its files.');
}

const OPERATIONS: Readonly<Record<string, (engine: Engine, call: Call) => Promise<unknown>>> = {
  'torrent.capabilities': async (engine) => (engine.options.connections.all().length > 0 ? TORRENT_CAPABILITIES : { ...TORRENT_CAPABILITIES, transports: [], modes: [] }),
  'torrent.add': add,
  'torrent.status': (engine, call) => onJob(engine, call, call.message.jobId, (record) => view(engine, record)),
  'torrent.jobs': list,
  'torrent.files': (engine, call) => onJob(engine, call, call.message.jobId, async (record, client) => (await client.files(record.infoHash)).map(torrentFileStatus)),
  'torrent.selectFiles': selectFiles,
  'torrent.pause': (engine, call) => setPaused(engine, call, true),
  'torrent.resume': (engine, call) => setPaused(engine, call, false),
  'torrent.remove': remove,
  'torrent.metadata': (engine, call) => onJob(engine, call, call.message.jobId, async (record) => torrentMetadata(await current(engine, record))),
  'torrent.update': update,
  'torrent.cancel': cancel,
  'torrent.pickFiles': unsupported,
  'torrent.read': unsupported,
  'torrent.exportMetainfo': unsupported,
  'torrent.saveFile': unsupported,
  'torrent.openFile': unsupported,
};

/** Answers one request with exactly one result, in the shape the wire table gives its type. */
function answer(engine: Engine, windowId: string, request: Envelope, send: (message: NappletMessage) => void): void {
  const { type, id } = request;
  const serve = async (): Promise<unknown> => {
    const applet = engine.options.appletOf(windowId)?.dTag;
    if (applet === undefined) throw new TorrentFailure('policy-denied');
    engine.windows.set(windowId, applet);
    return (OPERATIONS[type] as (engine: Engine, call: Call) => Promise<unknown>)(engine, { windowId, applet, message: request });
  };
  const fields = serve().then(
    (value): Record<string, unknown> => ({ [TORRENT_REQUESTS[type] as string]: value }),
    (error: unknown) => torrentFailureFields(type, request, torrentFailureFrom(error)),
  );
  void fields.then((payload) => {
    const result: Envelope = { type: `${type}.result`, id, ...payload };
    send(result);
    arm(engine);
  });
}

/** A session job ends with its window: its torrent is paused in its own program, never removed, unless another job still holds it there. */
function end(engine: Engine, windowId: string): void {
  engine.windows.delete(windowId);
  const ended = engine.jobs.endWindow(windowId);
  if (ended.length === 0) return;
  const pauseOrphans = async (): Promise<void> => {
    for (const record of ended) {
      const routed = routeOf(engine, record);
      if (routed && sharers(engine, record).length === 0) await routed.client.pause(record.infoHash);
    }
  };
  void serial(engine, pauseOrphans).catch(() => undefined);
}

function declared(types: readonly string[]): Record<string, null> {
  return Object.fromEntries(types.map((type) => [type, null]));
}

/**
 * The `torrent` service: applets download through the torrent program the person
 * already runs. kernl reaches that program over its own API and cannot read its files,
 * so everything that would hand an applet file contents answers `unsupported`, and the
 * program, not kernl, decides where files go.
 *
 * A job is one applet's hold on one torrent. The person is asked before every add and
 * before any deletion. A session job is paused in the program when its window ends; a
 * persistent job is kept in storage and found again by a later window of the same
 * applet. kernl never removes a torrent, or its data, that it was not asked to. Every
 * call to the program runs one after another, so a removal always wins over the
 * changes queued behind it, and one timer tells live windows what changed.
 *
 * The person may set up several torrent programs (D-053). A new torrent goes to the one a
 * job already holds it on, else to the person's default, and the question names it; every
 * later call for the job goes to that connection alone, and a job whose connection was
 * removed or is locked answers `source-unavailable` and can still be removed.
 *
 * @param options - The shell's hooks, the person's torrent connections and the refresh interval.
 * @returns The handler to register as `torrent`, and `dispose`.
 * @example
 * ```ts
 * const torrents = createTorrentService({ appletOf, ask, storage: localStorage, connections: programs.routing('torrent') });
 * registry.torrent = torrents.handler;
 * ```
 */
export function createTorrentService(options: TorrentServiceOptions): DownloadService {
  const engine: Engine = { options, jobs: createTorrentJobs(options.storage), windows: new Map(), runtimes: [], tail: Promise.resolve(), timer: undefined, unreachable: new Set(), disposed: false };
  return {
    handler: {
      descriptor: { name: 'torrent', version: '1.0.0', description: "Torrent downloads through the person's own torrent program" },
      messageCapabilities: declared(Object.keys(TORRENT_REQUESTS)),
      pushCapabilities: declared(TORRENT_PUSHES),
      onRegistered(context) {
        engine.runtimes.push(context);
      },
      onUnregistered() {
        engine.runtimes.length = 0;
      },
      handleMessage(windowId, message, send) {
        const request = message as Envelope;
        if (typeof request.id === 'string' && Object.hasOwn(OPERATIONS, request.type)) answer(engine, windowId, request, send);
      },
      onWindowDestroyed: (windowId) => end(engine, windowId),
      onPermissionRevoked: (windowId) => end(engine, windowId),
    },
    dispose() {
      engine.disposed = true;
      clearTimeout(engine.timer);
      for (const windowId of engine.windows.keys()) end(engine, windowId);
    },
  };
}
