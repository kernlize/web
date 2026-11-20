import { basicAuthorization, clientError, readClientJson, requestClient } from './http';
import { afterSending, known, needsSending, safeNzbStem, settle } from './nzb-common';
import type { ClientOptions, ClientProbe, NzbClient, NzbClientAction, NzbClientAdd, NzbClientCategory, NzbClientJob, NzbClientState } from './types';

type Raw = Readonly<Record<string, unknown>>;

/** One job as NZBGet answered it, kept beside its normalised form for what a change needs to know. */
interface Seen {
  readonly job: NzbClientJob;
  readonly inHistory: boolean;
  readonly raw: Raw;
}

interface Phase {
  readonly state: NzbClientState;
  readonly stage?: string;
}

type Call = (method: string, params: readonly unknown[]) => Promise<unknown>;

const ACTIONS: readonly NzbClientAction[] = ['pause', 'resume', 'cancel', 'retry', 'forget', 'delete'];

/** `listgroups` statuses, from `ListGroupsXmlCommand::DetectStatus` in NZBGet's source; the documentation omits the two `QS_` ones. */
const QUEUE_PHASES = new Map<string, Phase>([
  ['QUEUED', { state: 'queued' }],
  ['PAUSED', { state: 'paused' }],
  ['DOWNLOADING', { state: 'downloading' }],
  ['FETCHING', { state: 'queued', stage: 'Fetching the NZB' }],
  ['PP_QUEUED', { state: 'processing', stage: 'Waiting to process' }],
  ['QS_QUEUED', { state: 'processing', stage: 'Waiting to process' }],
  ['QS_EXECUTING', { state: 'processing', stage: 'Running a script' }],
  ['LOADING_PARS', { state: 'processing', stage: 'Checking' }],
  ['VERIFYING_SOURCES', { state: 'processing', stage: 'Verifying' }],
  ['REPAIRING', { state: 'processing', stage: 'Repairing' }],
  ['VERIFYING_REPAIRED', { state: 'processing', stage: 'Verifying' }],
  ['RENAMING', { state: 'processing', stage: 'Renaming' }],
  ['POST_UNPACK_RENAMING', { state: 'processing', stage: 'Renaming' }],
  ['POST_DOWNLOAD_RENAMING', { state: 'processing', stage: 'Renaming' }],
  ['UNPACKING', { state: 'processing', stage: 'Unpacking' }],
  ['MOVING', { state: 'processing', stage: 'Moving' }],
  ['EXECUTING_SCRIPT', { state: 'processing', stage: 'Running a script' }],
  ['PP_FINISHED', { state: 'processing', stage: 'Finishing' }],
]);
const NO_PHASE: Phase = { state: 'unknown' };
/** The phases in which a job still has articles to fetch, so its files can be held or parked. */
const TRANSFER_PHASES = new Set(['QUEUED', 'PAUSED', 'DOWNLOADING']);

/**
 * `history` statuses by their whole text first, then by the word before the slash.
 * A warning means NZBGet's own workflow did not end well (a script failed, a repair
 * was needed, articles were missing), so it is never reported as completed. Removal
 * by a duplicate rule is a skip; only a manual removal is a cancellation.
 */
const HISTORY_STATES = new Map<string, NzbClientState>([
  ['DELETED/MANUAL', 'cancelled'],
  ['SUCCESS', 'completed'],
  ['WARNING', 'failed'],
  ['FAILURE', 'failed'],
  ['DELETED', 'skipped'],
]);

const REASONS = new Map<string, string>([
  ['WARNING/SCRIPT', 'A processing script failed'],
  ['WARNING/SPACE', 'There was not enough room to unpack'],
  ['WARNING/PASSWORD', 'The archive needs a password, or the one given is wrong'],
  ['WARNING/DAMAGED', 'The download is damaged and repair is switched off'],
  ['WARNING/REPAIRABLE', 'The download is damaged; it can be repaired, but repair is switched off'],
  ['WARNING/HEALTH', 'Some articles were missing'],
  ['WARNING/SKIPPED', 'What was fetched is not an NZB'],
  ['FAILURE/PAR', 'Repair failed'],
  ['FAILURE/UNPACK', 'Unpacking failed'],
  ['FAILURE/MOVE', 'The files could not be moved into place'],
  ['FAILURE/SCAN', 'The NZB could not be read'],
  ['FAILURE/BAD', 'Marked as bad'],
  ['FAILURE/HEALTH', 'Too many articles were missing'],
  ['FAILURE/FETCH', 'The NZB could not be fetched'],
  ['DELETED/DUPE', 'Left out as a duplicate'],
  ['DELETED/COPY', 'Left out: the same NZB was already added'],
  ['DELETED/GOOD', 'Left out: a good copy already exists'],
]);

const PRIORITIES = { low: -50, normal: 0, high: 50 } as const;
const BASE64_CHUNK = 0x8000;
const LOG_LINES = 50;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function word(raw: Raw, key: string): string {
  const value = raw[key];
  return typeof value === 'string' ? value : '';
}

function whole(raw: Raw, key: string): number {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** NZBGet splits a byte count into two 32-bit halves, `…Lo` and `…Hi`. */
function wide(raw: Raw, key: string): number {
  return (whole(raw, `${key}Hi`) >>> 0) * 2 ** 32 + (whole(raw, `${key}Lo`) >>> 0);
}

function isJob(value: unknown): value is Raw {
  return isRecord(value) && Number.isSafeInteger(value['NZBID']) && whole(value, 'NZBID') > 0;
}

function jobs(value: unknown): readonly Raw[] {
  if (!Array.isArray(value) || !value.every(isJob)) throw clientError('unavailable:bad-response', 'the list was not what NZBGet sends');
  return value;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK));
  return btoa(binary);
}

function common(raw: Raw, state: NzbClientState): Pick<NzbClientJob, 'id' | 'name' | 'state' | 'downloadedBytes' | 'totalBytes' | 'category'> {
  const category = word(raw, 'Category');
  return {
    id: String(raw['NZBID']),
    name: word(raw, 'NZBName'),
    state,
    downloadedBytes: wide(raw, 'DownloadedSize'),
    totalBytes: wide(raw, 'FileSize'),
    ...(category === '' ? {} : { category }),
  };
}

function queued(raw: Raw): Seen {
  const status = word(raw, 'Status');
  const phase = QUEUE_PHASES.get(status) ?? NO_PHASE;
  const total = wide(raw, 'FileSize');
  const remaining = wide(raw, 'RemainingSize');
  const held = wide(raw, 'PausedSize');
  const transferring = word(raw, 'Kind') === 'NZB' && TRANSFER_PHASES.has(status);
  /** NZBGet's own test for PAUSED; it also holds while the last articles of a just-paused job are still arriving and the status reads DOWNLOADING. */
  const paused = held > 0 && held === remaining;
  const job: NzbClientJob = {
    ...common(raw, phase.state),
    ...(phase.stage === undefined ? {} : { stage: phase.stage }),
    ...(transferring ? { paused } : {}),
    ...(total > 0 ? { progress: Math.min(1, Math.max(0, (total - remaining) / total)) } : {}),
    // Post-processing gets no cancel: GroupParkDelete does nothing to a job that has left the download phase.
    actions: transferring ? [paused ? 'resume' : 'pause', 'cancel'] : [],
  };
  return { job, inHistory: false, raw };
}

/**
 * Whether hiding the record also removes the job's directory, as
 * `HistoryCoordinator::HistoryDelete` does for a job that was removed, failed repair
 * or failed unpacking. A missing field counts as yes, so removal is never offered as
 * a mere `forget` when it might delete.
 */
function removalDeletesFiles(raw: Raw): boolean {
  return word(raw, 'DeleteStatus') !== 'NONE' || word(raw, 'ParStatus') === 'FAILURE' || ['FAILURE', 'PASSWORD'].includes(word(raw, 'UnpackStatus'));
}

function historyActions(raw: Raw, state: NzbClientState): readonly NzbClientAction[] {
  if (word(raw, 'Kind') !== 'NZB' || state === 'unknown') return [];
  const removal: NzbClientAction = removalDeletesFiles(raw) ? 'delete' : 'forget';
  return state === 'failed' || state === 'cancelled' ? ['retry', removal] : [removal];
}

function finished(raw: Raw): Seen {
  const status = word(raw, 'Status');
  const state = HISTORY_STATES.get(status) ?? HISTORY_STATES.get(status.replace(/\/.*/, '')) ?? 'unknown';
  const message = REASONS.get(status);
  const job: NzbClientJob = {
    ...common(raw, state),
    ...(message === undefined ? {} : { message }),
    actions: historyActions(raw, state),
  };
  return { job, inHistory: true, raw };
}

function connect(options: ClientOptions): Call {
  const url = `${options.endpoint.url.replace(/\/+$/, '')}/jsonrpc`;
  const authorization = basicAuthorization(options.endpoint);
  // NZBGet closes every connection after one answer. Node's fetch reuses the one a 401 came on all the same, and the next request dies on it; asking for the close avoids that, and a browser ignores the header.
  const headers = { 'content-type': 'application/json', connection: 'close', ...(authorization === undefined ? {} : { authorization }) };
  return async (method, params) => {
    const response = await requestClient(options, url, { method: 'POST', headers, body: JSON.stringify({ method, params }) });
    const body = await readClientJson(response);
    if (!response.ok || !isRecord(body)) throw clientError('unavailable:bad-response', 'the answer was not what NZBGet sends');
    if ('error' in body) throw clientError('unavailable:unsupported', `this NZBGet does not take "${method}" that way`);
    return body['result'];
  };
}

function shows(test: (job: NzbClientJob) => boolean): (now: Seen | undefined) => boolean {
  return (now) => now !== undefined && test(now.job);
}

/**
 * The `editqueue` command for each change, and what must be seen afterwards. NZBGet
 * has one way to drop a history record, `HistoryDelete`; whether it is a `forget` or
 * a `delete` depends on the job (see {@link removalDeletesFiles}).
 */
const EDITS: Record<Exclude<NzbClientAction, 'retry'>, readonly [command: string, done: (now: Seen | undefined) => boolean]> = {
  pause: ['GroupPause', shows((job) => job.paused === true)],
  // A released job may be fetched, and even finished, before it is read again; all that must show is that the hold is gone.
  resume: ['GroupResume', shows((job) => job.paused !== true)],
  cancel: ['GroupParkDelete', shows((job) => job.state === 'cancelled')],
  forget: ['HistoryDelete', (now) => now === undefined],
  delete: ['HistoryDelete', (now) => now === undefined],
};

/** The moment a job last entered history and how much it has logged: both move when NZBGet takes a job back, even if it fails again at once. */
function mark(seen: Seen): string {
  return `${whole(seen.raw, 'HistoryTime')}/${whole(seen.raw, 'MessageCount')}`;
}

/**
 * Drives NZBGet through its JSON-RPC interface (`/jsonrpc`, HTTP Basic).
 *
 * What it offers, and why:
 *
 * - `pause`, `resume`, `cancel` for a job still fetching articles. Cancel is
 *   `GroupParkDelete`, the one removal that keeps what was downloaded and leaves a
 *   `DELETED/MANUAL` record; a job being repaired or unpacked offers nothing.
 * - `retry` for a failed or cancelled job: `HistoryRetryFailed`, which reuses the
 *   job's files, then `HistoryRedownload` only if NZBGet declined because those files
 *   are gone. The job keeps its id.
 * - `forget` or `delete`, never both: NZBGet removes the directory of a removed or
 *   failed job together with its record and keeps the output of one that ended well,
 *   so each job offers the one that describes what will happen.
 *
 * `editqueue` answers `true` for any job it found, whether or not it did anything, so
 * every change is confirmed by reading the job again.
 *
 * @param options - Where NZBGet answers (`username` and `password` are its control login), with an optional `fetch` and time limit.
 * @returns The adapter.
 * @example
 * ```ts
 * const nzbget = createNzbgetClient({ endpoint: { url: 'http://127.0.0.1:6789', username: 'nzbget', password: 'secret' } });
 * const { id } = await nzbget.add({ bytes, name: 'Example', paused: true });
 * await nzbget.control(id, 'resume');
 * ```
 */
export function createNzbgetClient(options: ClientOptions): NzbClient {
  const call = connect(options);

  async function look(): Promise<readonly Seen[]> {
    // Queue first: a job that finishes between the two reads then shows in both and the later reading wins; the other order would lose it.
    const queue = jobs(await call('listgroups', [0])).map(queued);
    const history = jobs(await call('history', [false])).map(finished);
    const later = new Set(history.map((seen) => seen.job.id));
    return [...queue.filter((seen) => !later.has(seen.job.id)), ...history];
  }

  async function find(id: string): Promise<Seen | undefined> {
    return (await look()).find((seen) => seen.job.id === id);
  }

  function edit(command: string, id: string): Promise<unknown> {
    return afterSending(() => call('editqueue', [command, '', [Number(id)]]));
  }

  async function retry(before: Seen): Promise<void> {
    for (const command of ['HistoryRetryFailed', 'HistoryRedownload']) {
      await edit(command, before.job.id);
      const after = await afterSending(() => find(before.job.id));
      if (after === undefined) throw clientError('unavailable:outcome-unknown', 'the job is gone');
      if (!after.inHistory || mark(after) !== mark(before)) return;
    }
    throw clientError('unavailable:rejected', 'NZBGet could not start the job again');
  }

  /** NZBGet only logs a directory it could not delete, so the log is where a half-done deletion shows. */
  async function insistFilesGone(seen: Seen): Promise<void> {
    const lines = await call('log', [0, LOG_LINES]).catch(() => undefined);
    const refusal = `Could not delete directory ${word(seen.raw, 'DestDir')}:`;
    if (!Array.isArray(lines) || lines.some((line) => isRecord(line) && word(line, 'Text').startsWith(refusal))) {
      throw clientError('unavailable:outcome-unknown', 'the record is gone, but NZBGet did not confirm that the files are');
    }
  }

  return {
    actions: ACTIONS,
    addOptions: ['categoryId', 'priority', 'startPaused', 'password'],

    async probe(): Promise<ClientProbe> {
      const version = await call('version', []);
      if (typeof version !== 'string') throw clientError('unavailable:bad-response', 'the answer was not what NZBGet sends');
      return { version };
    },

    async categories(): Promise<readonly NzbClientCategory[]> {
      const settings = await call('config', []);
      if (!Array.isArray(settings)) throw clientError('unavailable:bad-response', 'the settings were not what NZBGet sends');
      return settings
        .filter(isRecord)
        .filter((setting) => /^Category\d+\.Name$/.test(word(setting, 'Name')) && word(setting, 'Value') !== '')
        .map((setting) => ({ name: word(setting, 'Value') }));
    },

    async add(request: NzbClientAdd): Promise<{ readonly id: string }> {
      const password = request.password;
      // NZBGet's JSON-RPC reader keeps the backslashes of an escaped parameter value, so such a password would be stored wrong.
      if (password !== undefined && JSON.stringify(password) !== `"${password}"`) {
        throw clientError('unavailable:unsupported', 'NZBGet cannot take a password with a quote, a backslash or a control character');
      }
      // The reader takes parameters as strings in the order they appear, so the documented { Name, Value } form is read as two parameters called "Name" and "Value".
      const parameters = password === undefined ? [] : [{ '*Unpack:Password': password }];
      const submission = [`${safeNzbStem(request.name)}.nzb`, base64(request.bytes), request.category ?? '', PRIORITIES[request.priority ?? 'normal'], false, request.paused === true, '', 0, 'SCORE', ...parameters];
      const id = await afterSending(() => call('append', submission));
      if (typeof id !== 'number') throw clientError('unavailable:outcome-unknown', 'NZBGet did not say which job it made');
      if (id <= 0) throw clientError('unavailable:rejected', 'NZBGet did not take the document');
      return { id: String(id) };
    },

    async list(): Promise<readonly NzbClientJob[]> {
      return (await look()).map((seen) => seen.job);
    },

    async get(id: string): Promise<NzbClientJob | undefined> {
      return (await find(id))?.job;
    },

    async control(id: string, action: NzbClientAction): Promise<{ readonly id: string }> {
      const seen = known(await find(id));
      if (!needsSending(seen.job, action)) return { id };
      if (action === 'retry') {
        await retry(seen);
        return { id };
      }
      const [command, done] = EDITS[action];
      await edit(command, id);
      await settle(() => find(id), done);
      if (action === 'delete') await insistFilesGone(seen);
      return { id };
    },
  };
}
