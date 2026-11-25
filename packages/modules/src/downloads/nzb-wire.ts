/**
 * NAP-NZB wire shapes, written out here from the draft's tables.
 *
 * Upstream gap: `@napplet/core` 0.41 publishes no NAP-NZB types; the draft is
 * napplet/naps PR #136. Replace this file with the upstream types when they ship.
 */

/** Every error code NAP-NZB names. */
export type NzbErrorCode =
  | 'invalid_request'
  | 'permission_denied'
  | 'not_found'
  | 'unsupported'
  | 'invalid_state'
  | 'invalid_range'
  | 'not_ready'
  | 'file_changed'
  | 'limit_exceeded'
  | 'rate_limited'
  | 'authentication_required'
  | 'unavailable'
  | 'backend_rejected'
  | 'mutation_failed'
  | 'backend_error'
  | 'conflict'
  | 'outcome_unknown';

/** `NZBError`: why a request failed, in words an applet may show. */
export interface NzbError {
  readonly code: NzbErrorCode;
  readonly message: string;
  /** Present exactly when a mutation record exists. */
  readonly replayUntil?: number;
}

/** `JobState`: a job's normalised phase. */
export type NzbJobState = 'queued' | 'downloading' | 'paused' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped' | 'unknown';

/** `JobAction`: what can be asked of one job. */
export type NzbJobAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'forget' | 'delete';

/** An optional submission field a downloader can honour. */
export type NzbAddOption = 'categoryId' | 'priority' | 'startPaused' | 'password';

/** `Category`: one category choice a downloader offers. */
export interface NzbCategoryInfo {
  readonly categoryId: string;
  readonly label: string;
  readonly description: string;
}

/** `Downloader`: one downloader as discovery describes it. */
export interface NzbDownloaderInfo {
  readonly downloaderId: string;
  readonly label: string;
  readonly canAdd: boolean;
  readonly sourceKinds: readonly ('bytes' | 'url')[];
  readonly addOptions: readonly NzbAddOption[];
  readonly categories: readonly NzbCategoryInfo[];
  readonly actions: readonly NzbJobAction[];
  readonly canReadFiles: boolean;
  readonly maxNZBBytes: number;
  readonly maxPageSize: number;
  readonly maxReadBytes: number;
  readonly replaySeconds: number;
}

/** `DownloadersResult`. */
export interface NzbDownloadersResult {
  readonly downloaders: readonly NzbDownloaderInfo[];
}

/** `NZBSource`: exactly one NZB document, as bytes or by address. */
export type NzbSource = { readonly kind: 'bytes'; readonly dataBase64: string } | { readonly kind: 'url'; readonly url: string };

/** `AddRequest`. */
export interface NzbAddRequest {
  readonly downloaderId: string;
  readonly operationKey: string;
  readonly source: NzbSource;
  readonly name?: string;
  readonly categoryId?: string;
  readonly priority?: 'low' | 'normal' | 'high';
  readonly startPaused?: boolean;
  readonly password?: string;
}

/** `Job`: one observation of one job. */
export interface NzbJob {
  readonly jobId: string;
  readonly downloaderId: string;
  readonly name: string;
  readonly state: NzbJobState;
  readonly observedAt: number;
  readonly actions: readonly NzbJobAction[];
  readonly canReadFiles: boolean;
  readonly categoryId?: string;
  readonly downloadPaused?: boolean;
  readonly downloadProgress?: number;
  readonly downloadedBytes?: number;
  readonly totalBytes?: number;
  readonly downloadRate?: number;
  readonly stage?: string;
  readonly message?: string;
}

/** `AddResult`. */
export interface NzbAddResult {
  readonly job: NzbJob;
  readonly replayUntil: number;
}

/** `JobsRequest`, and `FilesRequest` with `jobId` in place of `downloaderId`. */
export interface NzbJobsRequest {
  readonly downloaderId: string;
  readonly after?: string;
  readonly limit?: number;
}

/** `JobsResult`. */
export interface NzbJobsResult {
  readonly jobs: readonly NzbJob[];
  readonly next: string | null;
}

/** `ControlRequest`. */
export interface NzbControlRequest {
  readonly jobId: string;
  readonly operationKey: string;
  readonly action: NzbJobAction;
}

/** `ControlResult`. */
export interface NzbControlResult {
  readonly jobId: string;
  readonly action: NzbJobAction;
  /** Present for pause, resume, cancel and retry. */
  readonly job?: NzbJob;
  readonly replayUntil: number;
}

/**
 * The limits this shell advertises for every downloader. kernl is a remote
 * control, so nothing can be read back: `maxReadBytes` is zero.
 *
 * @example
 * ```ts
 * NZB_LIMITS.maxNZBBytes; // 10485760
 * ```
 */
export const NZB_LIMITS = { maxNZBBytes: 10 * 1024 * 1024, maxPageSize: 100, maxReadBytes: 0, replaySeconds: 86_400 } as const;

/**
 * Every job action, in the order the draft lists them.
 *
 * @example
 * ```ts
 * NZB_ACTIONS.includes('pause'); // true
 * ```
 */
export const NZB_ACTIONS: readonly NzbJobAction[] = ['pause', 'resume', 'cancel', 'retry', 'forget', 'delete'];

/** A failure on its way to an applet: a code, plain words, and the replay boundary when a record exists. */
export class NzbFault extends Error {
  constructor(
    readonly code: NzbErrorCode,
    message: string,
    readonly replayUntil?: number,
  ) {
    super(message);
  }
}

/**
 * Stops the request with a NAP-NZB error unless a condition holds.
 *
 * @param condition - What must be true to carry on.
 * @param code - The NAP-NZB error code otherwise.
 * @param message - Plain words for the applet: no address, path, credential or backend id.
 * @returns Nothing; narrows `condition` to truthy.
 * @example
 * ```ts
 * need(typeof id === 'string', 'invalid_request', 'The request was not understood');
 * ```
 */
export function need(condition: unknown, code: NzbErrorCode, message: string): asserts condition {
  if (!condition) throw new NzbFault(code, message);
}
