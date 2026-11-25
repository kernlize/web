import type { TorrentClientFile, TorrentClientJob } from '@kernlize/bridges';
import type { TorrentFileStatus, TorrentJobState, TorrentJobStatus, TorrentJobSummary, TorrentRetention, TorrentSettings } from '@napplet/core';
import { createNamespacedStore, type StorageLike } from '@kernlize/kernel';
import { definedFields, readStoredTorrentJob, TorrentFailure, torrentMagnet, type StoredTorrentJob, type TorrentAddPlan, type TorrentServiceMode } from './torrent-wire.js';
import type { DownloadQuestion } from './types.js';

/** One applet's hold on one torrent in the person's program. */
export interface TorrentJobRecord {
  /** The owning applet's name; a job is never visible to another. */
  readonly applet: string;
  readonly jobId: string;
  readonly infoHash: string;
  /** The id of the connection the torrent was handed to; every later call goes there, or nowhere. */
  readonly connection: string;
  readonly retention: TorrentRetention;
  /** The window a session job lives and dies with; absent on a persistent job. */
  readonly windowId?: string;
  readonly title?: string;
  mode: TorrentServiceMode;
  revision: number;
  downloadLimit: number;
  uploadLimit: number;
  /** The applet paused it, so a finished download reads `paused`, not `complete`. */
  paused: boolean;
  /** The program no longer has the torrent; the job has ended in `error`. */
  failed: boolean;
  /** Nothing more will happen to it unasked, so it need not be watched. */
  idle: boolean;
  /** What the owning windows were last told, to tell them only what changed. */
  lastState?: TorrentJobState;
  lastNumbers?: string;
}

/** The jobs the service holds: session jobs in memory, persistent ones also in storage. */
export interface TorrentJobs {
  all(): readonly TorrentJobRecord[];
  /** Every job of an applet, whichever window made it. */
  owned(applet: string): readonly TorrentJobRecord[];
  /** The jobs a window may see: its applet's persistent jobs and its own session jobs. */
  visible(applet: string, windowId: string): readonly TorrentJobRecord[];
  /** Keeps a job; a persistent one is written to storage first, and is not kept when that fails. */
  add(record: TorrentJobRecord): void;
  drop(record: TorrentJobRecord): void;
  /** Writes a changed persistent job through to storage. */
  touch(record: TorrentJobRecord): void;
  /** Drops a window's session jobs and returns them. */
  endWindow(windowId: string): readonly TorrentJobRecord[];
}

const KEY = 'torrent-jobs:v1';

function stored(record: TorrentJobRecord): StoredTorrentJob {
  const { applet, jobId, infoHash, connection, mode, revision, downloadLimit, uploadLimit, paused, title } = record;
  return { applet, jobId, infoHash, connection, mode, revision, downloadLimit, uploadLimit, paused, ...(title === undefined ? {} : { title }) };
}

/**
 * The service's job records. Persistent jobs are read back from storage here, each one
 * checked field by field: a damaged entry, or a second entry under an id already
 * taken, is dropped instead of trusted.
 *
 * @param storage - Where persistent jobs are kept, under `kernl:torrent-jobs:v1`.
 * @returns The records.
 * @example
 * ```ts
 * const jobs = createTorrentJobs(localStorage);
 * jobs.visible('films', windowId);
 * ```
 */
export function createTorrentJobs(storage: StorageLike): TorrentJobs {
  const store = createNamespacedStore(storage, 'kernl');
  let records: TorrentJobRecord[] = [];
  const raw = store.getJson<unknown>(KEY, []);
  for (const entry of Array.isArray(raw) ? raw : []) {
    const job = readStoredTorrentJob(entry);
    if (job && !records.some((record) => record.applet === job.applet && record.jobId === job.jobId)) records.push({ ...job, retention: 'persistent', failed: false, idle: false });
  }
  const write = (kept: readonly TorrentJobRecord[]): void => {
    try {
      store.setJson(KEY, kept.filter((record) => record.retention === 'persistent').map(stored));
    } catch {
      throw new TorrentFailure('storage-denied', 'The job could not be kept.');
    }
  };
  return {
    all: () => [...records],
    owned: (applet) => records.filter((record) => record.applet === applet),
    visible: (applet, windowId) => records.filter((record) => record.applet === applet && (record.windowId ?? windowId) === windowId),
    add(record) {
      if (record.retention === 'persistent') write([...records, record]);
      records.push(record);
    },
    drop(record) {
      records = records.filter((kept) => kept !== record);
      if (record.retention === 'persistent') write(records);
    },
    touch(record) {
      if (record.retention === 'persistent') write(records);
    },
    endWindow(windowId) {
      const ended = records.filter((record) => record.windowId === windowId);
      records = records.filter((record) => record.windowId !== windowId);
      return ended;
    },
  };
}

/**
 * Whether the program has all of a torrent: it is sharing it, or holds it stopped and whole.
 *
 * @param job - The torrent as the program reports it.
 * @returns True once nothing is left to download.
 * @example
 * ```ts
 * torrentFinished(job) && record.mode === 'download'; // kernl pauses it
 * ```
 */
export function torrentFinished(job: TorrentClientJob): boolean {
  return job.state === 'seeding' || job.state === 'complete' || (job.state === 'paused' && job.progress === 1);
}

/** A finished torrent in `download` mode is `complete`, or `paused` when the applet paused it; everything else is the program's word. */
function stateOf(record: TorrentJobRecord, job: TorrentClientJob): TorrentJobState {
  if (!torrentFinished(job) || record.mode !== 'download') return job.state;
  return record.paused ? 'paused' : 'complete';
}

/**
 * A job's current settings. Tracker and web-seed lists are never disclosed, because a
 * tracker address can carry the person's private passkey.
 *
 * @param record - The job.
 * @returns Its settings and revision.
 * @example
 * ```ts
 * torrentJobSettings(record).endpointsRedacted; // true
 * ```
 */
export function torrentJobSettings(record: TorrentJobRecord): TorrentSettings {
  return {
    revision: record.revision,
    downloadLimitBytesPerSecond: record.downloadLimit,
    uploadLimitBytesPerSecond: record.uploadLimit,
    seedAfterComplete: record.mode === 'download-and-seed',
    endpointsRedacted: true,
  };
}

/**
 * A job's status snapshot from what the program reports now. What the program does not
 * know yet (size, progress, time left) is left out, never filled with zero.
 *
 * @param record - The job.
 * @param job - The torrent as the program reports it.
 * @returns The status.
 * @example
 * ```ts
 * torrentJobStatus(record, job).ratio; // uploaded / downloaded, or 0
 * ```
 */
export function torrentJobStatus(record: TorrentJobRecord, job: TorrentClientJob): TorrentJobStatus {
  return definedFields({
    ok: true as const,
    jobId: record.jobId,
    state: stateOf(record, job),
    mode: record.mode,
    transport: 'bittorrent',
    hashes: { v1: record.infoHash },
    downloadedBytes: job.downloadedBytes,
    uploadedBytes: job.uploadedBytes,
    totalBytes: job.totalBytes,
    progress: job.progress,
    downloadRate: job.downloadRate,
    uploadRate: job.uploadRate,
    ratio: job.downloadedBytes > 0 ? job.uploadedBytes / job.downloadedBytes : 0,
    peers: { peers: job.peers, seeds: job.seeds, leeches: job.leeches },
    title: job.name || undefined,
    etaSeconds: job.etaSeconds,
    settings: torrentJobSettings(record),
    retention: record.retention,
  });
}

/**
 * A job's line in a `jobs` listing. A job whose torrent the program no longer has is
 * listed in `error`, so the applet can still find and remove it.
 *
 * @param record - The job.
 * @param job - The torrent as the program reports it, or undefined when it is gone.
 * @returns The summary.
 * @example
 * ```ts
 * torrentJobSummary(record, undefined).state; // 'error'
 * ```
 */
export function torrentJobSummary(record: TorrentJobRecord, job: TorrentClientJob | undefined): TorrentJobSummary {
  const base = { jobId: record.jobId, mode: record.mode, transport: 'bittorrent', hashes: { v1: record.infoHash }, retention: record.retention };
  if (!job) return { ...base, state: 'error', downloadRate: 0, uploadRate: 0, ratio: 0 };
  const { state, progress, downloadRate, uploadRate, ratio, title } = torrentJobStatus(record, job);
  return definedFields({ ...base, state, progress, downloadRate, uploadRate, ratio, title });
}

/**
 * One file's status as the wire has it.
 *
 * @param file - The file as the program reports it.
 * @returns The file status; an empty file counts as whole.
 * @example
 * ```ts
 * torrentFileStatus({ index: 0, path: 'a.bin', size: 10, downloadedBytes: 5, selected: true, priority: 0 }).progress; // 0.5
 * ```
 */
export function torrentFileStatus(file: TorrentClientFile): TorrentFileStatus {
  const { index, path, size, selected, priority, downloadedBytes } = file;
  return { index, path, size, selected, priority, downloadedBytes, progress: size > 0 ? downloadedBytes / size : 1 };
}

/**
 * What `metadata` answers for a torrent the program has read: its identity and a magnet
 * built from the hash and name alone, with no tracker in it.
 *
 * @param job - The torrent as the program reports it.
 * @returns The metadata result.
 * @throws `metadata-unavailable` while the program has not read the torrent, or cannot say whether it is private.
 * @example
 * ```ts
 * torrentMetadata(job).magnet; // 'magnet:?xt=urn:btih:…&dn=Night%20Mix'
 * ```
 */
export function torrentMetadata(job: TorrentClientJob): Record<string, unknown> {
  if (job.state === 'metadata' || job.private === undefined) throw new TorrentFailure('metadata-unavailable');
  return definedFields({
    ok: true,
    format: 'v1',
    hashes: { v1: job.infoHash },
    name: job.name,
    private: job.private,
    magnet: torrentMagnet(job.infoHash, job.name),
    endpointsRedacted: true,
    metainfoReady: false,
  });
}

const PEERS_SEE = { label: 'Other people see', value: 'The network address of the machine running your torrent program' };

function naming(subject: { readonly title?: string; readonly infoHash: string }): DownloadQuestion['lines'] {
  return [...(subject.title ? [{ label: 'Name', value: subject.title }] : []), { label: 'Torrent', value: subject.infoHash }];
}

/**
 * The question put to the person before a torrent is handed to their program.
 *
 * @param plan - The validated request.
 * @param program - The label of the connection the torrent goes to.
 * @returns What is added, where, how long it shares, who sees what, and what closing the applet does.
 * @example
 * ```ts
 * describeTorrentAdd(plan, 'Home').title; // 'Add a torrent to Home'
 * ```
 */
export function describeTorrentAdd(plan: TorrentAddPlan, program: string): DownloadQuestion {
  return {
    kind: 'add',
    title: `Add a torrent to ${program}`,
    lines: [
      ...naming(plan),
      { label: 'Program', value: program },
      { label: 'Sharing', value: plan.mode === 'download' ? 'Stops when the download finishes' : 'Keeps sharing with other people after the download finishes' },
      PEERS_SEE,
      { label: 'If you close this applet', value: plan.retention === 'session' ? 'The download pauses' : 'The download carries on in your torrent program' },
    ],
  };
}

/**
 * The question put to the person before downloaded files are deleted.
 *
 * @param record - The job being removed.
 * @returns What is deleted, and where.
 * @example
 * ```ts
 * describeTorrentDelete(record).kind; // 'delete'
 * ```
 */
export function describeTorrentDelete(record: TorrentJobRecord): DownloadQuestion {
  return {
    kind: 'delete',
    title: 'Delete the torrent\'s files',
    lines: [...naming(record), { label: 'Deletes', value: 'The files this torrent downloaded, on the machine running your torrent program' }],
  };
}
