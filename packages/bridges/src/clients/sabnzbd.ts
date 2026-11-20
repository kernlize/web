import { clientError, readClientText, requestClient } from './http';
import { afterSending, known, needsSending, safeNzbStem, settle } from './nzb-common';
import type { ClientOptions, ClientProbe, NzbClient, NzbClientAction, NzbClientAdd, NzbClientCategory, NzbClientJob, NzbClientState } from './types';

type Raw = Readonly<Record<string, unknown>>;
type Fields = Readonly<Record<string, string>>;

interface Upload {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

type Call = (fields: Fields, upload?: Upload) => Promise<Raw>;

interface Phase {
  readonly state: NzbClientState;
  readonly stage?: string;
  /** The job's own hold, for the phases in which SABnzbd can set and clear it. */
  readonly paused?: boolean;
}

/**
 * SABnzbd removes a queued job without leaving any record of it, and has no way to
 * stop one that is being repaired or unpacked and keep its files, so there is no
 * honest `cancel` (NAP-NZB, "Job control").
 */
const ACTIONS: readonly NzbClientAction[] = ['pause', 'resume', 'retry', 'forget', 'delete'];

const QUEUE_PHASES = new Map<string, Phase>([
  ['Paused', { state: 'paused', paused: true }],
  ['Queued', { state: 'queued', paused: false }],
  ['Downloading', { state: 'queued', paused: false }],
  ['Fetching', { state: 'queued', paused: false, stage: 'Fetching repair data' }],
  ['Propagating', { state: 'queued', paused: false, stage: 'Waiting for the articles to spread' }],
  ['Checking', { state: 'queued', paused: false, stage: 'Checking' }],
  ['Grabbing', { state: 'queued', stage: 'Fetching the NZB' }],
]);
/** The statuses SABnzbd gives a job it is, or soon will be, fetching articles for. */
const TRANSFER_STATUSES = new Set(['Downloading', 'Fetching']);

/** A job still in SABnzbd's post-processing line is listed in its history with one of the working statuses. */
const HISTORY_PHASES = new Map<string, Phase>([
  ['Completed', { state: 'completed' }],
  ['Failed', { state: 'failed' }],
  ['Queued', { state: 'processing', stage: 'Waiting to process' }],
  ['QuickCheck', { state: 'processing', stage: 'Checking' }],
  ['Verifying', { state: 'processing', stage: 'Verifying' }],
  ['Repairing', { state: 'processing', stage: 'Repairing' }],
  ['Fetching', { state: 'processing', stage: 'Fetching repair data' }],
  ['Extracting', { state: 'processing', stage: 'Unpacking' }],
  ['Moving', { state: 'processing', stage: 'Moving' }],
  ['Running', { state: 'processing', stage: 'Running a script' }],
]);
const NO_PHASE: Phase = { state: 'unknown' };

const PRIORITIES = { low: '-1', normal: '0', high: '1' } as const;
/** As a priority, -2 tells SABnzbd to add the job with its hold already set. */
const ADD_PAUSED = '-2';
/** `*` is SABnzbd's "Default", and a job without a category reads "None". */
const NO_CATEGORY = new Set(['', '*', 'None']);
const MEBIBYTE = 1_048_576;
/** SABnzbd shows only its ten latest history entries unless a limit is named. */
const HISTORY_PAGE = 200;
const LONGEST_MESSAGE = 200;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function word(raw: Raw, key: string): string {
  const value = raw[key];
  return typeof value === 'string' ? value : '';
}

/** Sizes arrive as numbers in history and as decimal text ("12.50") in the queue. */
function amount(raw: Raw, key: string): number {
  const value = Number(raw[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function part(answer: Raw, key: 'queue' | 'history'): Raw {
  const value = answer[key];
  if (!isRecord(value)) throw clientError('unavailable:bad-response', 'the answer was not what SABnzbd sends');
  return value;
}

function isSlot(value: unknown): value is Raw {
  return isRecord(value) && word(value, 'nzo_id') !== '';
}

function slots(listing: Raw): readonly Raw[] {
  const value = listing['slots'];
  if (!Array.isArray(value) || !value.every(isSlot)) throw clientError('unavailable:bad-response', 'the list was not what SABnzbd sends');
  return value;
}

/** SABnzbd's failure text can hold a link, markup or a folder on its disk; none of that is passed on. */
function plain(message: string): string | undefined {
  const words = message
    .replace(/<[^>]*>/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/(?:\b[a-z]:)?[\\/]\S*/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-:,]+$/, '')
    .trim()
    .slice(0, LONGEST_MESSAGE);
  return words === '' ? undefined : words;
}

function category(name: string): { readonly category?: string } {
  return NO_CATEGORY.has(name) ? {} : { category: name };
}

function queued(slot: Raw, transferring: boolean): NzbClientJob {
  const phase = QUEUE_PHASES.get(word(slot, 'status')) ?? NO_PHASE;
  const total = amount(slot, 'mb');
  const left = Math.min(total, amount(slot, 'mbleft'));
  return {
    id: word(slot, 'nzo_id'),
    name: word(slot, 'filename'),
    state: transferring ? 'downloading' : phase.state,
    downloadedBytes: Math.round((total - left) * MEBIBYTE),
    // A job smaller than SABnzbd's two decimals of a mebibyte reads as 0.00, which says nothing about its size.
    ...(total > 0 ? { totalBytes: Math.round(total * MEBIBYTE), progress: (total - left) / total } : {}),
    ...(phase.paused === undefined ? {} : { paused: phase.paused }),
    ...(phase.stage === undefined ? {} : { stage: phase.stage }),
    ...category(word(slot, 'cat')),
    actions: phase.paused === undefined ? [] : [phase.paused ? 'resume' : 'pause'],
  };
}

/**
 * Removing a history entry never touches finished output, so a completed job can only
 * be forgotten. A failed job's `retry` flag is SABnzbd saying its folder of partial
 * files is still there: what a retry reuses, and what a delete removes.
 */
function historyActions(slot: Raw, state: NzbClientState): readonly NzbClientAction[] {
  if (state === 'completed') return ['forget'];
  if (state !== 'failed') return [];
  return slot['retry'] === true || slot['retry'] === 1 ? ['retry', 'forget', 'delete'] : ['forget'];
}

function finished(slot: Raw): NzbClientJob {
  const phase = HISTORY_PHASES.get(word(slot, 'status')) ?? NO_PHASE;
  const message = phase.state === 'failed' ? plain(word(slot, 'fail_message')) : undefined;
  return {
    id: word(slot, 'nzo_id'),
    name: word(slot, 'name'),
    state: phase.state,
    downloadedBytes: amount(slot, 'bytes'),
    ...(phase.stage === undefined ? {} : { stage: phase.stage }),
    ...(message === undefined ? {} : { message }),
    ...category(word(slot, 'category')),
    actions: historyActions(slot, phase.state),
  };
}

function connect(options: ClientOptions): Call {
  const url = `${options.endpoint.url.replace(/\/+$/, '')}/api`;
  const key = options.endpoint.apiKey;
  return async (fields, upload) => {
    // Everything goes in the body of a POST: a key in the address would end up in the downloader's and any proxy's access logs.
    const all = { output: 'json', ...(key === undefined ? {} : { apikey: key }), ...fields };
    let body: URLSearchParams | FormData = new URLSearchParams(all);
    if (upload !== undefined) {
      body = new FormData();
      for (const [name, value] of Object.entries(all)) body.set(name, value);
      // The copy is what makes the bytes a plain ArrayBuffer view, the only kind a Blob takes.
      body.set('name', new Blob([upload.bytes.slice()], { type: 'application/x-nzb' }), upload.fileName);
    }
    const response = await requestClient(options, url, { method: 'POST', body });
    const text = await readClientText(response);
    // Before 5.0 a wrong or missing key was answered 200 with these words as plain text.
    if (/^\s*API Key /i.test(text)) throw clientError('denied:credentials');
    const answer = response.ok ? parse(text) : undefined;
    if (!isRecord(answer)) throw clientError('unavailable:bad-response', 'the answer was not what SABnzbd sends');
    if (answer['status'] === false && /api key/i.test(word(answer, 'error'))) throw clientError('denied:credentials');
    return answer;
  };
}

function shows(test: (job: NzbClientJob) => boolean): (now: NzbClientJob | undefined) => boolean {
  return (now) => now !== undefined && test(now);
}

/**
 * The request for each change that needs no more than the job's id, and what must be
 * seen afterwards. `del_files` only ever removes a failed job's folder of partial
 * files; without `archive=0` the entry moves to SABnzbd's archive, out of the list.
 */
const CHANGES: Partial<Record<NzbClientAction, readonly [fields: Fields, done: (now: NzbClientJob | undefined) => boolean]>> = {
  pause: [{ mode: 'queue', name: 'pause' }, shows((job) => job.paused === true)],
  // A released job may be fetched, and even finished, before it is read again; all that must show is that the hold is gone.
  resume: [{ mode: 'queue', name: 'resume' }, shows((job) => job.paused !== true)],
  forget: [{ mode: 'history', name: 'delete', del_files: '0' }, (now) => now === undefined],
  delete: [{ mode: 'history', name: 'delete', del_files: '1' }, (now) => now === undefined],
};

/**
 * Drives SABnzbd through its HTTP interface (`/api`, API key).
 *
 * What it offers, and why:
 *
 * - `pause` and `resume` for a job in the queue, always the per-job requests.
 * - No `cancel`: see {@link ACTIONS}.
 * - `retry` for a failed job whose partial files SABnzbd still has. SABnzbd makes a
 *   new job for the attempt, so the id that comes back is the successor's.
 * - `forget` for a completed or failed job, and `delete` only for a failed job with
 *   partial files: SABnzbd never deletes finished output.
 *
 * A job is reported `downloading` only when SABnzbd is transferring and the job is the
 * first in line; SABnzbd's own "Downloading" also covers jobs waiting behind it.
 * Pause, resume and removal answer `true` even for a job that does not exist, so every
 * change is confirmed by reading the job again.
 *
 * A job cannot be added both held and with a priority of its own: the hold is itself
 * a priority value, and changing the priority afterwards releases it.
 *
 * @param options - Where SABnzbd answers and its API key (`apiKey`), with an optional `fetch` and time limit.
 * @returns The adapter.
 * @example
 * ```ts
 * const sabnzbd = createSabnzbdClient({ endpoint: { url: 'http://127.0.0.1:8080', apiKey: '24e3…' } });
 * const { id } = await sabnzbd.add({ bytes, name: 'Example', paused: true });
 * await sabnzbd.control(id, 'resume');
 * ```
 */
export function createSabnzbdClient(options: ClientOptions): NzbClient {
  const call = connect(options);

  async function change(fields: Fields, upload?: Upload): Promise<Raw> {
    const answer = await afterSending(() => call(fields, upload));
    if (answer['status'] === false) throw clientError('unavailable:rejected', 'SABnzbd declined the request');
    return answer;
  }

  async function readQueue(): Promise<readonly NzbClientJob[]> {
    const queue = part(await call({ mode: 'queue' }), 'queue');
    const all = slots(queue);
    const first = word(queue, 'status') === 'Downloading' ? all.find((slot) => TRANSFER_STATUSES.has(word(slot, 'status'))) : undefined;
    return all.map((slot) => queued(slot, slot === first));
  }

  async function readHistory(only?: string): Promise<readonly NzbClientJob[]> {
    const found: Raw[] = [];
    for (;;) {
      const fields = { mode: 'history', start: String(found.length), limit: String(HISTORY_PAGE), ...(only === undefined ? {} : { nzo_ids: only }) };
      const page = slots(part(await call(fields), 'history'));
      found.push(...page);
      if (page.length < HISTORY_PAGE) return found.map(finished);
    }
  }

  async function look(only?: string): Promise<readonly NzbClientJob[]> {
    // Queue first, and history wins: a job that leaves the queue between the two reads then shows in both instead of in neither.
    const merged = new Map<string, NzbClientJob>();
    for (const job of [...(await readQueue()), ...(await readHistory(only))]) merged.set(job.id, job);
    return [...merged.values()];
  }

  /** Matched whole: SABnzbd reads a comma as a list and `all` or `failed` as every job, and no job has such an id. */
  async function find(id: string): Promise<NzbClientJob | undefined> {
    return (await look(id)).find((job) => job.id === id);
  }

  async function retry(id: string): Promise<{ readonly id: string }> {
    const successor = word(await change({ mode: 'retry', value: id }), 'nzo_id');
    if (successor === '') throw clientError('unavailable:outcome-unknown', 'SABnzbd did not say which job it made');
    await settle(
      () => find(successor),
      (now) => now !== undefined,
    );
    return { id: successor };
  }

  return {
    actions: ACTIONS,
    addOptions: ['categoryId', 'priority', 'startPaused', 'password'],

    async probe(): Promise<ClientProbe> {
      // The queue rather than `mode=version`, which answers without a key and so would call a wrong key fine.
      const version = word(part(await call({ mode: 'queue', limit: '1' }), 'queue'), 'version');
      if (version === '') throw clientError('unavailable:bad-response', 'the answer was not what SABnzbd sends');
      return { version };
    },

    async categories(): Promise<readonly NzbClientCategory[]> {
      const names = (await call({ mode: 'get_cats' }))['categories'];
      if (!Array.isArray(names)) throw clientError('unavailable:bad-response', 'the categories were not what SABnzbd sends');
      return names.filter((name): name is string => typeof name === 'string' && !NO_CATEGORY.has(name)).map((name) => ({ name }));
    },

    async add(request: NzbClientAdd): Promise<{ readonly id: string }> {
      const held = request.paused === true;
      const priority = request.priority === undefined ? undefined : PRIORITIES[request.priority];
      if (held && priority !== undefined && priority !== PRIORITIES.normal) {
        throw clientError('unavailable:unsupported', 'SABnzbd cannot add a job both held and with its own priority');
      }
      // SABnzbd reads "name{{secret}}" in a job name as an archive password.
      const stem = safeNzbStem(request.name.replace(/[{}]/g, ' '));
      const fields = {
        mode: 'addfile',
        nzbname: stem,
        ...(request.category === undefined ? {} : { cat: request.category }),
        ...(held ? { priority: ADD_PAUSED } : priority === undefined ? {} : { priority }),
        ...(request.password === undefined ? {} : { password: request.password }),
      };
      const ids = (await change(fields, { fileName: `${stem}.nzb`, bytes: request.bytes }))['nzo_ids'];
      const id: unknown = Array.isArray(ids) ? ids[0] : undefined;
      if (typeof id !== 'string' || id === '') throw clientError('unavailable:outcome-unknown', 'SABnzbd did not say which job it made');
      return { id };
    },

    list(): Promise<readonly NzbClientJob[]> {
      return look();
    },

    get(id: string): Promise<NzbClientJob | undefined> {
      return find(id);
    },

    async control(id: string, action: NzbClientAction): Promise<{ readonly id: string }> {
      if (!ACTIONS.includes(action)) throw clientError('unavailable:unsupported', 'SABnzbd cannot stop a job and keep a record of it');
      if (!needsSending(known(await find(id)), action)) return { id };
      const sending = CHANGES[action];
      if (sending === undefined) return retry(id);
      const [fields, done] = sending;
      await change({ ...fields, value: id });
      await settle(() => find(id), done);
      return { id };
    },
  };
}
