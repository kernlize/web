import type { ServiceRuntimeContext } from '@kehto/runtime';
import type { TorrentClient, TorrentClientJob } from '@kernlize/bridges';
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
  /** The person's torrent client, read on every request; undefined when none is set up. */
  readonly client: () => TorrentClient | undefined;
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
  /** The program could not be reached at the last refresh, and the windows were told. */
  unreachable: boolean;
  disposed: boolean;
}

const NOT_SET_UP = 'No torrent program is set up.';
const GONE = 'Your torrent program no longer has this torrent.';

/** Runs work after everything queued before it, whether that succeeded or not. */
function serial<T>(engine: Engine, work: () => Promise<T>): Promise<T> {
  const run = engine.tail.then(work);
  engine.tail = run.catch(() => undefined);
  return run;
}

function program(engine: Engine, code = 'network-error'): TorrentClient {
  const client = engine.options.client();
  if (!client) throw new TorrentFailure(code, NOT_SET_UP);
  return client;
}

/** A session job speaks to its own window; a persistent job to every live window of its applet. */
function recipients(engine: Engine, record: TorrentJobRecord): readonly string[] {
  if (record.windowId !== undefined) return [record.windowId];
  return [...engine.windows].filter(([, applet]) => applet === record.applet).map(([windowId]) => windowId);
}

function push(engine: Engine, record: TorrentJobRecord, message: Envelope): void {
  for (const windowId of recipients(engine, record)) for (const runtime of engine.runtimes) runtime.sendToEligibleNapplet(windowId, message);
}

/** The other jobs holding the same torrent. */
function sharers(engine: Engine, record: TorrentJobRecord): readonly TorrentJobRecord[] {
  return engine.jobs.all().filter((other) => other !== record && other.infoHash === record.infoHash);
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
async function settle(engine: Engine, record: TorrentJobRecord, job: TorrentClientJob | undefined): Promise<TorrentClientJob | undefined> {
  if (record.failed || !job) {
    record.failed = true;
    return undefined;
  }
  if (job.downloadLimit !== record.downloadLimit || job.uploadLimit !== record.uploadLimit) {
    Object.assign(record, { downloadLimit: job.downloadLimit, uploadLimit: job.uploadLimit, revision: record.revision + 1 });
    engine.jobs.touch(record);
  }
  const wanted = [record, ...sharers(engine, record)].some((owner) => !owner.failed && owner.mode === 'download-and-seed');
  if (job.state === 'seeding' && !wanted) await program(engine).pause(record.infoHash);
  return job;
}

async function current(engine: Engine, record: TorrentJobRecord): Promise<TorrentClientJob> {
  const job = await settle(engine, record, await program(engine).get(record.infoHash));
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

function watched(engine: Engine): readonly TorrentJobRecord[] {
  return engine.jobs.all().filter((record) => !record.idle && recipients(engine, record).length > 0);
}

/** One reading of the program for every watched job. An outage is told once, not every tick. */
async function poll(engine: Engine): Promise<void> {
  const records = watched(engine);
  try {
    const list = await program(engine).list();
    for (const record of records) report(engine, record, await settle(engine, record, list.find((job) => job.infoHash === record.infoHash)));
    engine.unreachable = false;
  } catch (error) {
    const reason = torrentFailureFrom(error).reason as string;
    if (!engine.unreachable) for (const record of records) push(engine, record, { type: 'torrent.error', jobId: record.jobId, error: 'network-error', reason });
    engine.unreachable = true;
  }
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
    record.idle = false;
    return act(record, program(engine));
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
async function start(engine: Engine, call: Call, plan: TorrentAddPlan): Promise<Record<string, unknown>> {
  if (engine.windows.get(call.windowId) !== call.applet) throw new TorrentFailure('policy-denied');
  admit(engine, call.applet, plan);
  const client = program(engine, 'unsupported-transport');
  const { infoHash, mode, retention, title, downloadLimit, uploadLimit, startPaused } = plan;
  const state = startPaused ? 'paused' : 'queued';
  const record: TorrentJobRecord = {
    applet: call.applet,
    jobId: plan.jobId ?? `tor-${crypto.randomUUID()}`,
    infoHash, retention, mode, downloadLimit, uploadLimit,
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

async function add(engine: Engine, call: Call): Promise<Record<string, unknown>> {
  const plan = await planTorrentAdd(call.message.request);
  program(engine, 'unsupported-transport');
  admit(engine, call.applet, plan);
  if (!(await engine.options.ask(call.windowId, describeTorrentAdd(plan)))) throw new TorrentFailure('user-denied');
  return serial(engine, () => start(engine, call, plan));
}

/**
 * A torrent another job still holds stays in the program with its data, whatever was
 * asked. Data is deleted only when the person said yes to this very removal.
 */
async function remove(engine: Engine, call: Call): Promise<Record<string, unknown>> {
  const jobId = torrentText(call.message.jobId);
  const asking = wantsTorrentDataDeleted(call.message.options) && sharers(engine, visible(engine, call, jobId)).length === 0;
  if (asking && !(await engine.options.ask(call.windowId, describeTorrentDelete(visible(engine, call, jobId))))) throw new TorrentFailure('user-denied');
  return serial(engine, async () => {
    const record = visible(engine, call, jobId);
    const job = sharers(engine, record).length === 0 ? await program(engine).get(record.infoHash) : undefined;
    if (job) await program(engine).remove(record.infoHash, asking);
    engine.jobs.drop(record);
    return { ok: true, jobId, deletedData: asking && job !== undefined };
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

/** An applet with no jobs is answered without troubling the program. */
function list(engine: Engine, call: Call): Promise<unknown> {
  const filter = planTorrentFilter(call.message.filter);
  return serial(engine, async () => {
    const mine = engine.jobs.visible(call.applet, call.windowId);
    if (mine.length === 0) return [];
    const reported = await program(engine).list();
    const summaries = [];
    for (const record of mine) summaries.push(torrentJobSummary(record, await settle(engine, record, reported.find((job) => job.infoHash === record.infoHash))));
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
  'torrent.capabilities': async (engine) => (engine.options.client() ? TORRENT_CAPABILITIES : { ...TORRENT_CAPABILITIES, transports: [], modes: [] }),
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

/** A session job ends with its window: its torrent is paused, never removed, unless another job still holds it. */
function end(engine: Engine, windowId: string): void {
  engine.windows.delete(windowId);
  const ended = engine.jobs.endWindow(windowId);
  if (ended.length === 0) return;
  const pauseOrphans = async (): Promise<void> => {
    for (const record of ended) if (sharers(engine, record).length === 0) await program(engine).pause(record.infoHash);
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
 * @param options - The shell's hooks, the person's torrent client and the refresh interval.
 * @returns The handler to register as `torrent`, and `dispose`.
 * @example
 * ```ts
 * const torrents = createTorrentService({ appletOf, ask, storage: localStorage, client: () => transmission });
 * registry.torrent = torrents.handler;
 * ```
 */
export function createTorrentService(options: TorrentServiceOptions): DownloadService {
  const engine: Engine = { options, jobs: createTorrentJobs(options.storage), windows: new Map(), runtimes: [], tail: Promise.resolve(), timer: undefined, unreachable: false, disposed: false };
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
