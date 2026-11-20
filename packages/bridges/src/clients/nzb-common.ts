import { clientError } from './http';
import type { NzbClientAction, NzbClientJob } from './types';

const LONGEST_STEM = 150;
/** Path separators, the characters Windows forbids in a file name, and control characters. */
const UNSAFE = /[\\/:*?"<>|\p{Cc}]+/gu;
const EDGES = /^[.\s]+|[.\s]+$/g;
/** How often a job is looked at after a change was sent, and how long to wait between looks. */
const OBSERVATIONS = 4;
const OBSERVATION_GAP_MS = 250;
/** Failures that leave it open whether the downloader received and applied what was sent. */
const MAY_HAVE_APPLIED = /^unavailable:(?:timeout|unreachable|bad-response)/;

/**
 * Makes a display name safe to hand a downloader as a file name: no separators, no
 * reserved or control characters, no leading or trailing dots, a bounded length, and
 * never empty. A name is a label here, so nothing in it can select a directory.
 *
 * @param name - The display name a caller suggested.
 * @returns The name without an extension; append `.nzb` for the file name.
 * @example
 * ```ts
 * safeNzbStem('../../etc/My Show.nzb'); // 'etc My Show'
 * ```
 */
export function safeNzbStem(name: string): string {
  const stem = name
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .replace(EDGES, '')
    .replace(/\.nzb$/i, '')
    .slice(0, LONGEST_STEM)
    .replace(EDGES, '');
  return stem === '' ? 'download' : stem;
}

/**
 * Runs a request that may change the downloader. A timeout, a broken connection or an
 * unreadable answer after sending says nothing about whether the change was applied
 * (NAP-NZB, "Error Handling"), so those become `unavailable:outcome-unknown`.
 *
 * @param run - The request.
 * @returns What the request resolved with.
 * @example
 * ```ts
 * const answer = await afterSending(() => call('editqueue', ['GroupPause', '', [7]]));
 * ```
 */
export async function afterSending<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (MAY_HAVE_APPLIED.test((error as Error).message)) throw clientError('unavailable:outcome-unknown', 'the downloader did not confirm the change');
    throw error;
  }
}

/**
 * Looks at a job after a change was sent until the change shows, a few times over
 * about a second. Downloaders answer `true` to changes they did not make, so only
 * what is seen afterwards counts (NAP-NZB, "Job control").
 *
 * @param observe - Reads the job afresh.
 * @param done - Whether what was read shows the change.
 * @returns The observation that showed it.
 * @throws `unavailable:outcome-unknown` when the change never shows or the job cannot be read.
 * @example
 * ```ts
 * await settle(() => client.get(id), (job) => job?.paused === true);
 * ```
 */
export async function settle<T>(observe: () => Promise<T>, done: (seen: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < OBSERVATIONS; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, OBSERVATION_GAP_MS));
    const seen = await afterSending(observe);
    if (done(seen)) return seen;
  }
  throw clientError('unavailable:outcome-unknown', 'the change could not be confirmed');
}

/**
 * Insists that a job was found.
 *
 * @param seen - What a lookup returned.
 * @returns The same value, now known to be there.
 * @throws `unavailable:not-found` when the downloader has no such job.
 * @example
 * ```ts
 * const job = known(await client.get(id));
 * ```
 */
export function known<T>(seen: T | undefined): T {
  if (seen === undefined) throw clientError('unavailable:not-found');
  return seen;
}

/**
 * Decides whether an action has to be sent for a job as it is now. A hold that is
 * already as asked needs nothing sent (NAP-NZB, "Job control").
 *
 * @param job - The job as just observed.
 * @param action - What was asked.
 * @returns True to send it; false when a pause or resume already holds.
 * @throws `invalid:state` when the job's phase does not allow the action.
 * @example
 * ```ts
 * if (!needsSending(job, 'pause')) return { id: job.id };
 * ```
 */
export function needsSending(job: NzbClientJob, action: NzbClientAction): boolean {
  if (job.actions.includes(action)) return true;
  if ((action === 'pause' && job.paused === true) || (action === 'resume' && job.paused === false)) return false;
  throw clientError('invalid:state', `the job cannot ${action} now`);
}
