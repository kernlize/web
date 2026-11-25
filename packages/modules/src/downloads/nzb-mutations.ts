import type { NzbClientAdd, NzbClientJob } from '@kernlize/bridges';
import { readNzbDocument, type NzbDocument } from './nzb-document.js';
import { digestNzbRequest, type NzbReplayHit, type NzbReplayScope } from './nzb-replay.js';
import { decodeNzbBase64, readNzbAdd, readNzbControl } from './nzb-requests.js';
import { describeNzbJob, observeNzbJob, nzbDownloaderOf, nzbFaultOf, nzbJobOf, type NzbCall, type NzbDownloader, type NzbOwnedJob, type NzbSession } from './nzb-session.js';
import { need, NZB_LIMITS, NzbFault, type NzbAddOption, type NzbAddRequest, type NzbAddResult, type NzbControlRequest, type NzbControlResult, type NzbJobAction } from './nzb-wire.js';

const FETCH_DEADLINE_MS = 30_000;
const TERMINAL: readonly string[] = ['completed', 'failed', 'cancelled', 'skipped'];
const ADD_OPTIONS: readonly NzbAddOption[] = ['categoryId', 'priority', 'startPaused', 'password'];
const REVOKED = 'This applet may no longer use downloads';

/** What a mutation hands back when it worked: the result without its replay boundary, and the job handles it names. */
interface Done<R> {
  readonly result: Omit<R, 'replayUntil'>;
  readonly jobIds: readonly string[];
}

/** One mutation: its record's scope, what it is compared by, the checks that leave no record, and the work itself. */
interface Mutation<R, P> {
  readonly scope: NzbReplayScope;
  readonly operation: 'add' | 'control';
  readonly request: unknown;
  /** Everything that can be refused before a record is reserved; nothing here reaches outside the shell with a change. */
  readonly prepare: () => Promise<P>;
  /** The work; `sending` is called the moment before the downloader is told. */
  readonly run: (prepared: P, sending: () => void) => Promise<Done<R>>;
}

function replayed<R>(session: NzbSession, applet: string, hit: NzbReplayHit): R {
  if (hit.conflict) throw new NzbFault('conflict', 'This operation key was already used for a different request', hit.replayUntil);
  if ('error' in hit.outcome) throw new NzbFault(hit.outcome.error.code, hit.outcome.error.message, hit.replayUntil);
  // NAP-NZB, Mutation replay: a recorded success is authorised again before it is delivered.
  need(
    hit.jobIds.every((jobId) => session.handles.job(applet, jobId)),
    'permission_denied',
    'This download is no longer this applet’s',
  );
  return { ...hit.outcome.result, replayUntil: hit.replayUntil } as R;
}

/**
 * Carries out one mutation under its replay record (NAP-NZB, Mutation replay). The
 * key is looked up and reserved in one step with nothing awaited in between, so the
 * same request arriving twice is sent once. Work that ends before the downloader was
 * told anything gives the key back; anything after that is recorded, error or not.
 */
async function mutate<R, P>(session: NzbSession, mutation: Mutation<R, P>): Promise<R> {
  const { scope } = mutation;
  const digest = await digestNzbRequest(mutation.operation, mutation.request);
  session.replay.prune();
  session.handles.forget(scope.applet, session.replay.referenced(scope.applet));
  const earlier = session.replay.find(scope, digest);
  if (earlier) return replayed(session, scope.applet, earlier);
  const prepared = await mutation.prepare();
  const meanwhile = session.replay.find(scope, digest);
  if (meanwhile) return replayed(session, scope.applet, meanwhile);
  session.replay.reserve(scope, digest);
  let sent = false;
  const sending = (): void => {
    session.replay.dispatched(scope);
    sent = true;
  };
  try {
    const done = await mutation.run(prepared, sending);
    return { ...done.result, replayUntil: session.replay.settle(scope, { result: done.result }, done.jobIds) } as R;
  } catch (error) {
    const { code, message } = nzbFaultOf(error, sent);
    if (sent) throw new NzbFault(code, message, session.replay.settle(scope, { error: { code, message } }, []));
    session.replay.release(scope);
    throw new NzbFault(code, message);
  }
}

interface Checked {
  readonly bytes: Uint8Array;
  readonly document: NzbDocument;
}

function checkDocument(bytes: Uint8Array): Checked {
  need(bytes.length <= NZB_LIMITS.maxNZBBytes, 'limit_exceeded', 'The NZB document is larger than the shell accepts');
  try {
    return { bytes, document: readNzbDocument(bytes) };
  } catch (error) {
    throw new NzbFault('invalid_request', `The NZB document was not accepted: ${(error as Error).message.slice('invalid:nzb '.length)}`);
  }
}

interface AddPlan {
  /** The downloader's own name for the chosen category, and the label the person knows it by. */
  readonly category?: string;
  /** Present for a `bytes` source, which is checked before anything is reserved. */
  readonly checked?: Checked;
}

async function planAdd(session: NzbSession, call: NzbCall, downloader: NzbDownloader, request: NzbAddRequest): Promise<AddPlan> {
  const { client } = downloader;
  need(request.source.kind === 'bytes' || session.options.fetchDocument, 'unsupported', 'This downloader takes NZB documents as bytes only');
  need(
    ADD_OPTIONS.every((option) => request[option] === undefined || client.addOptions.includes(option)),
    'unsupported',
    'This downloader cannot honour one of the options asked for',
  );
  const category = request.categoryId === undefined ? undefined : session.handles.categoryName(call.applet, downloader.key, request.categoryId);
  need(request.categoryId === undefined || category !== undefined, 'not_found', 'No such category');
  // NAP-NZB, Submission: an unknown category is never swapped for another, so one the downloader has since dropped is refused.
  if (category !== undefined) need((await client.categories()).some((offered) => offered.name === category), 'not_found', 'No such category');
  if (request.source.kind === 'url') return category === undefined ? {} : { category };
  const encoded = request.source.dataBase64;
  need(encoded.length <= Math.ceil(NZB_LIMITS.maxNZBBytes / 3) * 4, 'limit_exceeded', 'The NZB document is larger than the shell accepts');
  return { ...(category === undefined ? {} : { category }), checked: checkDocument(decodeNzbBase64(encoded)) };
}

async function fetched(session: NzbSession, url: string): Promise<Checked> {
  const fetchDocument = session.options.fetchDocument as NonNullable<NzbSession['options']['fetchDocument']>;
  // The address may carry a token in its query, so neither it nor the fetcher's own words go any further.
  const bytes = await fetchDocument(url, AbortSignal.any([session.signal, AbortSignal.timeout(FETCH_DEADLINE_MS)])).catch(() => {
    throw new NzbFault('unavailable', 'The NZB document could not be fetched');
  });
  return checkDocument(bytes);
}

/**
 * `nzb.add`: hands one NZB document to one downloader after the person said yes.
 * The document is validated before the downloader sees it, the person is told the
 * download carries on in that program after the applet is closed, and a no leaves
 * neither a job nor a record.
 *
 * @param session - The service's session.
 * @param call - Whose request this is.
 * @param raw - The `AddRequest` as received.
 * @returns The `AddResult`.
 * @example
 * ```ts
 * const { job, replayUntil } = await addNzb(session, call, { downloaderId, operationKey: 'add-1', source });
 * ```
 */
export async function addNzb(session: NzbSession, call: NzbCall, raw: unknown): Promise<NzbAddResult> {
  const request = readNzbAdd(raw);
  const downloader = nzbDownloaderOf(session, call.applet, request.downloaderId);
  const { client, key, label } = downloader;
  const run = async (plan: AddPlan, sending: () => void): Promise<Done<NzbAddResult>> => {
    const { bytes, document } = plan.checked ?? (await fetched(session, (request.source as { url: string }).url));
    const name = request.name ?? document.name;
    const lines = [
      { label: 'Name', value: name },
      { label: 'Files', value: document.files === 1 ? '1 file' : `${document.files} files` },
      ...(plan.category === undefined ? [] : [{ label: 'Category', value: plan.category }]),
      { label: 'Keeps going', value: `This download carries on in ${label} after this applet is closed` },
    ];
    need(await session.options.ask(call.windowId, { kind: 'add', title: `Add an NZB job to ${label}`, lines }), 'permission_denied', 'The person declined this download');
    need(call.live(), 'permission_denied', REVOKED);
    const submission: NzbClientAdd = {
      bytes,
      name,
      ...(plan.category === undefined ? {} : { category: plan.category }),
      ...(request.priority === undefined ? {} : { priority: request.priority }),
      ...(request.startPaused === undefined ? {} : { paused: request.startPaused }),
      ...(request.password === undefined ? {} : { password: request.password }),
    };
    sending();
    const { id } = await client.add(submission);
    const handle = { applet: call.applet, id: session.handles.jobId(call.applet, key, id), key, backend: id, gone: false };
    // The job is identified, so it is reported even when it cannot be looked at yet: as `unknown`, never as a guess.
    const seen = (await client.get(id).catch(() => undefined)) ?? ({ id, name, state: 'unknown', actions: [] } satisfies NzbClientJob);
    return { result: { job: describeNzbJob(session, { handle, downloader }, seen) }, jobIds: [handle.id] };
  };
  return mutate(session, { scope: { applet: call.applet, downloader: key, operationKey: request.operationKey }, operation: 'add', request, prepare: () => planAdd(session, call, downloader, request), run });
}

/** NAP-NZB, Job control: a hold already set or cleared satisfies pause or resume without new work in the downloader. */
function alreadyHeld(job: NzbClientJob, action: NzbJobAction): boolean {
  return !TERMINAL.includes(job.state) && ((action === 'pause' && job.paused === true) || (action === 'resume' && job.paused === false));
}

async function applyControl(session: NzbSession, call: NzbCall, owned: NzbOwnedJob, request: NzbControlRequest, sending: () => void): Promise<Done<NzbControlResult>> {
  const { handle, downloader } = owned;
  const { jobId, action } = request;
  const stale = 'That no longer applies to this download';
  let seen = await observeNzbJob(session, owned);
  if (alreadyHeld(seen, action)) return { result: { jobId, action, job: describeNzbJob(session, owned, seen) }, jobIds: [jobId] };
  need(seen.actions.includes(action), 'invalid_state', stale);
  if (action === 'delete') {
    const lines = [
      { label: 'Name', value: seen.name },
      { label: 'Erases', value: `The files this download saved, and its record in ${downloader.label}` },
    ];
    need(await session.options.ask(call.windowId, { kind: 'delete', title: `Erase a download from ${downloader.label}`, lines }), 'permission_denied', 'Deleting download data is not authorized');
    seen = await observeNzbJob(session, owned);
    need(seen.actions.includes(action), 'invalid_state', stale);
  }
  need(call.live(), 'permission_denied', REVOKED);
  sending();
  const { id } = await downloader.client.control(handle.backend, action);
  if (action === 'forget' || action === 'delete') {
    session.handles.retire(handle.applet, handle.id);
    return { result: { jobId, action }, jobIds: [jobId] };
  }
  const after = await downloader.client.get(id).catch(() => undefined);
  need(after, 'outcome_unknown', 'The downloader took the request, but the download could not be seen afterwards');
  // A retry may make a successor; it gets a handle of its own and the original's is left as it was.
  const successor = id === handle.backend ? handle : { ...handle, id: session.handles.jobId(handle.applet, handle.key, id), backend: id };
  return { result: { jobId, action, job: describeNzbJob(session, { handle: successor, downloader }, after) }, jobIds: [jobId, successor.id] };
}

/**
 * `nzb.control`: one action on one job the applet submitted. Changes to one job take
 * turns, the job is looked at again before anything is sent, and `delete` asks the
 * person first because it erases files.
 *
 * @param session - The service's session.
 * @param call - Whose request this is.
 * @param raw - The `ControlRequest` as received.
 * @returns The `ControlResult`.
 * @example
 * ```ts
 * await controlNzb(session, call, { jobId, operationKey: 'pause-1', action: 'pause' });
 * ```
 */
export async function controlNzb(session: NzbSession, call: NzbCall, raw: unknown): Promise<NzbControlResult> {
  const request = readNzbControl(raw);
  const owned = nzbJobOf(session, call.applet, request.jobId);
  const { handle, downloader } = owned;
  return mutate(session, {
    scope: { applet: call.applet, downloader: downloader.key, operationKey: request.operationKey },
    operation: 'control',
    request,
    // A job that is gone still answers a replay of what was done to it, so this is checked only for a new key.
    prepare: async () => {
      need(!handle.gone, 'not_found', 'No such download');
      need(downloader.client.actions.includes(request.action), 'unsupported', 'This downloader cannot do that');
    },
    run: (_prepared, sending) => session.inTurn(`${handle.key}\n${handle.backend}`, () => applyControl(session, call, owned, request, sending)),
  });
}
