import type { NzbClient, NzbClientJob } from '@kernlize/bridges';
import type { DownloadServiceDeps } from './types.js';
import type { NzbHandles, NzbJobHandle } from './nzb-handles.js';
import type { NzbReplay } from './nzb-replay.js';
import { need, NzbFault, type NzbErrorCode, type NzbJob } from './nzb-wire.js';

/** One downloader the person set up. */
export interface NzbDownloader {
  /**
   * What handles are issued against; never sent to an applet. The shell passes the connection's
   * routing key, which changes with its address, so a handle issued for one server's job never
   * reaches another server's job with the same id.
   */
  readonly key: string;
  /** What the person calls it. */
  readonly label: string;
  readonly client: NzbClient;
}

/** What the NZB service needs from the shell. */
export interface NzbServiceOptions extends DownloadServiceDeps {
  /** The downloaders the person set up, read on every request. */
  readonly downloaders: () => readonly NzbDownloader[];
  /** Fetches an NZB for a `url` source under the shell's own fetch policy; without it only `bytes` is offered. */
  readonly fetchDocument?: (url: string, signal: AbortSignal) => Promise<Uint8Array>;
}

/** One request being answered: whose it is, and whether its answer is still wanted. */
export interface NzbCall {
  readonly windowId: string;
  /** The applet's stable name, which handles and records are scoped to. */
  readonly applet: string;
  /** False once the window closed, lost the domain or runs another applet; checked again before every effect. */
  readonly live: () => boolean;
}

/** What every NZB operation works with. */
export interface NzbSession {
  readonly options: NzbServiceOptions;
  /** Whole seconds since the epoch. */
  readonly now: () => number;
  readonly handles: NzbHandles;
  readonly replay: NzbReplay;
  /** Aborted when the service is torn down. */
  readonly signal: AbortSignal;
  /** Runs work after everything queued earlier under the same name, so changes to one job take turns. */
  readonly inTurn: <T>(lane: string, work: () => Promise<T>) => Promise<T>;
}

/** A job handle together with the downloader it lives on. */
export interface NzbOwnedJob {
  readonly handle: NzbJobHandle;
  readonly downloader: NzbDownloader;
}

interface Failure {
  readonly reason: string;
  readonly code: NzbErrorCode;
  readonly message: string;
  /** Whether, once a change was sent, this failure leaves open that it was applied. */
  readonly uncertain?: true;
}

const UNSURE = 'This may have been carried out; check the download, then ask again with the same operation key';

/** {@link import('@kernlize/bridges').ClientFailure} reasons as NAP-NZB errors, in words that name no address, path or id. */
const FAILURES: readonly Failure[] = [
  { reason: 'denied:credentials', code: 'authentication_required', message: 'The downloader refused the sign-in the shell holds for it' },
  { reason: 'unavailable:unreachable', code: 'unavailable', message: 'The downloader could not be reached' },
  { reason: 'unavailable:timeout', code: 'unavailable', message: 'The downloader did not answer in time', uncertain: true },
  { reason: 'unavailable:rejected', code: 'backend_rejected', message: 'The downloader declined' },
  { reason: 'unavailable:not-found', code: 'not_found', message: 'The downloader has no such download' },
  { reason: 'unavailable:unsupported', code: 'unsupported', message: 'The downloader cannot do that' },
  { reason: 'unavailable:outcome-unknown', code: 'outcome_unknown', message: UNSURE },
  { reason: 'invalid:state', code: 'invalid_state', message: 'The download is no longer in a state where that applies' },
  { reason: 'invalid:', code: 'backend_rejected', message: 'The downloader declined' },
  { reason: '', code: 'backend_error', message: 'The request could not be completed', uncertain: true },
];

/**
 * Turns whatever an operation threw into the error an applet is sent. An adapter's
 * failure is read by its stable reason and never quoted. Once a change has been sent,
 * a missing or unreadable acknowledgement is `outcome_unknown`, never a claim that
 * nothing happened (NAP-NZB, Error Handling).
 *
 * @param error - What was thrown.
 * @param sent - Whether a change had been sent to the downloader.
 * @returns The fault to answer with.
 * @example
 * ```ts
 * nzbFaultOf(new Error('unavailable:timeout'), true).code; // 'outcome_unknown'
 * ```
 */
export function nzbFaultOf(error: unknown, sent: boolean): NzbFault {
  if (error instanceof NzbFault) return error;
  const reason = error instanceof Error ? error.message : '';
  const failure = FAILURES.find((row) => reason.startsWith(row.reason)) as Failure;
  return sent && failure.uncertain ? new NzbFault('outcome_unknown', UNSURE) : new NzbFault(failure.code, failure.message);
}

/**
 * The downloaders the person set up, each key once: a key names one server, so a
 * second downloader under a key already seen is not offered.
 *
 * @param session - The service's session.
 * @returns The downloaders, first of each key.
 * @example
 * ```ts
 * nzbDownloaders(session).map((downloader) => downloader.label); // ['Home']
 * ```
 */
export function nzbDownloaders(session: NzbSession): readonly NzbDownloader[] {
  return session.options.downloaders().filter((downloader, index, all) => all.findIndex((other) => other.key === downloader.key) === index);
}

/**
 * The downloader an applet's handle stands for.
 *
 * @param session - The service's session.
 * @param applet - The applet asking.
 * @param downloaderId - The handle it sent.
 * @returns The downloader; `not_found` when the handle is not this applet's or the downloader is no longer set up.
 * @example
 * ```ts
 * nzbDownloaderOf(session, 'reader', downloaderId).label; // 'Home'
 * ```
 */
export function nzbDownloaderOf(session: NzbSession, applet: string, downloaderId: string): NzbDownloader {
  const key = session.handles.downloaderKey(applet, downloaderId);
  const downloader = nzbDownloaders(session).find((candidate) => candidate.key === key);
  need(downloader, 'not_found', 'No such downloader');
  return downloader;
}

/**
 * The job an applet's handle stands for, which may be one the downloader no longer has.
 * A job another applet or the person added has no handle here, so it is concealed.
 *
 * @param session - The service's session.
 * @param applet - The applet asking.
 * @param jobId - The handle it sent.
 * @returns The handle and its downloader; `not_found` otherwise.
 * @example
 * ```ts
 * nzbJobOf(session, 'reader', jobId).handle.gone; // false
 * ```
 */
export function nzbJobOf(session: NzbSession, applet: string, jobId: string): NzbOwnedJob {
  const handle = session.handles.job(applet, jobId);
  const downloader = nzbDownloaders(session).find((candidate) => candidate.key === handle?.key);
  need(handle && downloader, 'not_found', 'No such download');
  return { handle, downloader };
}

/**
 * One observation of a job in NAP-NZB's shape. kernl is a remote control, so
 * `canReadFiles` is always false; fields the downloader did not report are left out.
 *
 * @param session - The service's session.
 * @param owned - The applet's handle and the downloader.
 * @param job - What the downloader reported just now.
 * @returns The `Job`.
 * @example
 * ```ts
 * describeNzbJob(session, owned, await owned.downloader.client.get(owned.handle.backend));
 * ```
 */
export function describeNzbJob(session: NzbSession, owned: NzbOwnedJob, job: NzbClientJob): NzbJob {
  const { handle, downloader } = owned;
  const optional = {
    categoryId: job.category === undefined ? undefined : session.handles.categoryId(handle.applet, handle.key, job.category),
    downloadPaused: job.paused,
    downloadProgress: job.progress,
    downloadedBytes: job.downloadedBytes,
    totalBytes: job.totalBytes,
    downloadRate: job.downloadRate,
    stage: job.stage,
    message: job.message,
  };
  return {
    jobId: handle.id,
    downloaderId: session.handles.downloaderId(handle.applet, handle.key),
    name: job.name,
    state: job.state,
    observedAt: session.now(),
    actions: job.actions.filter((action) => downloader.client.actions.includes(action)),
    canReadFiles: false,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
  };
}

/**
 * A fresh look at one job. A job the downloader answers for no longer is marked gone,
 * so its handle is never bound to whatever the downloader numbers the same way later
 * (NAP-NZB, Common values); a downloader that does not answer leaves the handle alone.
 *
 * @param session - The service's session.
 * @param owned - The applet's handle and the downloader.
 * @returns What the downloader reports; `not_found` once it has no such job.
 * @example
 * ```ts
 * const job = await observeNzbJob(session, nzbJobOf(session, 'reader', jobId));
 * ```
 */
export async function observeNzbJob(session: NzbSession, owned: NzbOwnedJob): Promise<NzbClientJob> {
  need(!owned.handle.gone, 'not_found', 'No such download');
  const seen = await owned.downloader.client.get(owned.handle.backend);
  if (!seen) session.handles.retire(owned.handle.applet, owned.handle.id);
  need(seen, 'not_found', 'No such download');
  return seen;
}
