import { magnetInfoHash, readTorrentMetainfo, type TorrentClientSource } from '@kernlize/bridges';
import type { TorrentCapabilities, TorrentRetention } from '@napplet/core';

/** The two ways kernl can run a torrent in a program it only controls from outside. */
export type TorrentServiceMode = 'download' | 'download-and-seed';

/**
 * Every request an applet can send, with the name its answer travels under. `ack` and
 * `result` answers are records that say `ok: false` themselves; the others answer a
 * failure with a top-level `error`.
 */
export const TORRENT_REQUESTS: Readonly<Record<string, 'ack' | 'capabilities' | 'files' | 'jobs' | 'result' | 'status'>> = {
  'torrent.capabilities': 'capabilities',
  'torrent.pickFiles': 'result',
  'torrent.add': 'ack',
  'torrent.status': 'status',
  'torrent.jobs': 'jobs',
  'torrent.files': 'files',
  'torrent.selectFiles': 'status',
  'torrent.pause': 'status',
  'torrent.resume': 'status',
  'torrent.remove': 'result',
  'torrent.metadata': 'result',
  'torrent.read': 'result',
  'torrent.exportMetainfo': 'result',
  'torrent.saveFile': 'result',
  'torrent.openFile': 'result',
  'torrent.cancel': 'result',
  'torrent.update': 'result',
};

/** What the service sends a window without being asked. */
export const TORRENT_PUSHES: readonly string[] = ['torrent.state', 'torrent.progress', 'torrent.error'];

const MEBIBYTE = 1024 * 1024;
const MAX_MAGNET_LENGTH = 16 * 1024;
const MAX_TITLE_LENGTH = 200;
const V1_ONLY = 'Only BitTorrent v1 torrents can be handed on.';
const UNREACHABLE = 'Your torrent program could not be reached.';
const MODES: readonly string[] = ['download', 'seed', 'download-and-seed'];
const STATES: readonly string[] = ['queued', 'metadata', 'downloading', 'seeding', 'paused', 'complete', 'cancelled', 'error'];

/**
 * What kernl offers over a torrent program it reaches through that program's own API.
 * It cannot read the program's files, so reads, saving, opening, exporting and seeding
 * local files are all off; the read limits are the smallest the schema allows.
 */
export const TORRENT_CAPABILITIES: TorrentCapabilities = {
  transports: ['bittorrent'],
  modes: ['download', 'download-and-seed'],
  formats: ['v1'],
  createFormats: [],
  retentions: ['session', 'persistent'],
  mutableSettings: ['downloadLimitBytesPerSecond', 'uploadLimitBytesPerSecond', 'seedAfterComplete'],
  maxReadBytes: 1,
  maxReadWaitMs: 1,
  maxPendingReads: 1,
  maxMetainfoBytes: 2 * MEBIBYTE,
  canSaveFiles: false,
  canOpenFiles: false,
  canSeedRuntimeFiles: false,
  maxActiveJobs: 32,
};

/** A refusal in the spec's own words: the machine-readable error, and a reason for a developer to read. */
export class TorrentFailure extends Error {
  constructor(
    readonly code: string,
    readonly reason?: string,
    /** Fields the failed result also carries, such as the settings beside `revision-conflict`. */
    readonly extra: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
  }
}

/** What an adapter's rejection means to an applet. The words name no address and no secret. */
const CLIENT_FAILURES: readonly (readonly [prefix: string, code: string, reason: string])[] = [
  ['denied:credentials', 'network-error', "Your torrent program refused kernl's sign-in."],
  ['unavailable:rejected', 'invalid-source', 'Your torrent program declined the torrent.'],
  ['unavailable:not-found', 'job-not-found', 'Your torrent program does not have this torrent.'],
  ['unavailable:unsupported', 'unsupported', 'Your torrent program cannot do that.'],
];

/**
 * Turns anything thrown while serving a request into a refusal the spec names. An
 * adapter's own message never travels on: only its stable prefix is read.
 *
 * @param error - A {@link TorrentFailure}, or an adapter's rejection.
 * @returns The refusal to answer with.
 * @example
 * ```ts
 * torrentFailureFrom(new Error('unavailable:timeout')).code; // 'network-error'
 * ```
 */
export function torrentFailureFrom(error: unknown): TorrentFailure {
  if (error instanceof TorrentFailure) return error;
  const message = String((error as Error).message);
  const known = CLIENT_FAILURES.find(([prefix]) => message.startsWith(prefix));
  return known ? new TorrentFailure(known[1], known[2]) : new TorrentFailure('network-error', UNREACHABLE);
}

/**
 * Drops the keys whose value is undefined, so an unknown is absent on the wire, never
 * null and never zero.
 *
 * @param value - A record whose unknown fields are undefined.
 * @returns The record without them.
 * @example
 * ```ts
 * definedFields({ jobId: 'tor-1', totalBytes: undefined }); // { jobId: 'tor-1' }
 * ```
 */
export function definedFields<T>(value: { [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/**
 * The fields of a failed answer, shaped as the wire table has them for that request.
 *
 * @param type - The request's type.
 * @param message - The request, read only for the job id a failed `remove` repeats.
 * @param failure - The refusal.
 * @returns The fields to send beside `type` and `id`.
 * @example
 * ```ts
 * torrentFailureFields('torrent.status', message, new TorrentFailure('job-not-found')); // { error: 'job-not-found' }
 * ```
 */
export function torrentFailureFields(type: string, message: Readonly<Record<string, unknown>>, failure: TorrentFailure): Record<string, unknown> {
  const field = TORRENT_REQUESTS[type] as string;
  if (field !== 'ack' && field !== 'result') return { error: failure.code };
  const jobId = typeof message.jobId === 'string' ? message.jobId : '';
  const body = definedFields({ ok: false, jobId: type === 'torrent.remove' ? jobId : undefined, error: failure.code, reason: failure.reason, ...failure.extra });
  return { [field]: body };
}

type Check = (value: unknown) => boolean;

const isRecord: Check = (value) => typeof value === 'object' && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value);
const isAnything: Check = () => true;
const isText: Check = (value) => typeof value === 'string';
const isFlag: Check = (value) => typeof value === 'boolean';
const isCount: Check = (value) => Number.isSafeInteger(value) && (value as number) >= 0;
const isName: Check = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const isHash: Check = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const oneOf = (allowed: readonly unknown[]): Check => (value) => allowed.includes(value);
const listOf = (check: Check): Check => (value) => Array.isArray(value) && value.every(check);

/**
 * Reads a record strictly: every key present must be a known field holding a value of
 * the right kind, and every required field must be there.
 *
 * @param value - What arrived.
 * @param fields - The fields allowed, each with its check.
 * @param required - The fields that must be present.
 * @returns The record, or undefined when it does not fit.
 * @example
 * ```ts
 * torrentRecord({ deleteData: true }, { deleteData: (value) => typeof value === 'boolean' }); // { deleteData: true }
 * ```
 */
export function torrentRecord(value: unknown, fields: Readonly<Record<string, Check>>, required: readonly string[] = []): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const record = value as Record<string, unknown>;
  const fits = Object.keys(record).every((key) => Object.hasOwn(fields, key) && (record[key] === undefined || (fields[key] as Check)(record[key])));
  return fits && required.every((key) => record[key] !== undefined) ? record : undefined;
}

interface Shape {
  readonly fields: Readonly<Record<string, Check>>;
  readonly required?: readonly string[];
  /** What a misfit is refused as; `invalid-request` unless said. */
  readonly code?: string;
}

function need<T>(value: unknown, shape: Shape): T {
  const record = torrentRecord(value, shape.fields, shape.required);
  if (!record) throw new TorrentFailure(shape.code ?? 'invalid-request');
  return record as T;
}

/**
 * An id a request must carry as text: a job's, or another request's.
 *
 * @param value - The request's `jobId` or `requestId`.
 * @returns The id.
 * @throws `invalid-request` when it is not text.
 * @example
 * ```ts
 * torrentText(message.jobId);
 * ```
 */
export function torrentText(value: unknown): string {
  if (typeof value !== 'string') throw new TorrentFailure('invalid-request');
  return value;
}

/** A stored job as it is kept between reloads. */
export interface StoredTorrentJob {
  readonly applet: string;
  readonly jobId: string;
  readonly infoHash: string;
  /** The id of the connection the torrent was handed to. */
  readonly connection: string;
  readonly mode: TorrentServiceMode;
  readonly revision: number;
  readonly downloadLimit: number;
  readonly uploadLimit: number;
  readonly paused: boolean;
  readonly title?: string;
}

const STORED_JOB: Shape = {
  fields: { applet: isText, jobId: isName, infoHash: isHash, connection: isName, mode: oneOf(['download', 'download-and-seed']), revision: isCount, downloadLimit: isCount, uploadLimit: isCount, paused: isFlag, title: isText },
  required: ['applet', 'jobId', 'infoHash', 'connection', 'mode', 'revision', 'downloadLimit', 'uploadLimit', 'paused'],
};

/**
 * Reads one job back out of storage, trusting nothing about it.
 *
 * @param value - One entry of the stored list.
 * @returns The job, or undefined when the entry is damaged.
 * @example
 * ```ts
 * readStoredTorrentJob({ applet: 'films' }); // undefined
 * ```
 */
export function readStoredTorrentJob(value: unknown): StoredTorrentJob | undefined {
  return torrentRecord(value, STORED_JOB.fields, STORED_JOB.required) as StoredTorrentJob | undefined;
}

/** A validated `add`: what to hand the program, and the job to keep for it. */
export interface TorrentAddPlan {
  readonly source: TorrentClientSource;
  readonly infoHash: string;
  /** The torrent's name when the source says one; a magnet's is only what the applet claims. */
  readonly title?: string;
  readonly jobId?: string;
  readonly mode: TorrentServiceMode;
  readonly retention: TorrentRetention;
  readonly startPaused: boolean;
  readonly downloadLimit: number;
  readonly uploadLimit: number;
}

type Identified = Pick<TorrentAddPlan, 'source' | 'infoHash' | 'title'>;

interface ClaimedHashes {
  readonly v1?: string;
  readonly v2?: string;
}

const HASHES: Shape = { fields: { v1: isHash, v2: (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) }, code: 'invalid-infohash' };

/**
 * A magnet link that names a torrent by its hash and, when there is one, its name.
 * Nothing else goes in: no tracker, no web seed, no peer.
 *
 * @param infoHash - The v1 info hash, 40 lowercase hexadecimal characters.
 * @param name - The display name, or empty text for none.
 * @returns The magnet link.
 * @example
 * ```ts
 * torrentMagnet('ab'.repeat(20), 'Night Mix'); // 'magnet:?xt=urn:btih:abab…&dn=Night%20Mix'
 * ```
 */
export function torrentMagnet(infoHash: string, name: string): string {
  return `magnet:?xt=urn:btih:${infoHash}${name ? `&dn=${encodeURIComponent(name)}` : ''}`;
}

function readMagnet(source: Readonly<Record<string, unknown>>): Identified {
  const magnet = source.magnet;
  if (typeof magnet !== 'string' || magnet.length > MAX_MAGNET_LENGTH) throw new TorrentFailure('invalid-magnet');
  const query = new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1));
  try {
    return definedFields<Identified>({ source: { kind: 'magnet', magnet }, infoHash: magnetInfoHash(magnet), title: query.get('dn')?.slice(0, MAX_TITLE_LENGTH) || undefined });
  } catch {
    const onlyV2 = query.getAll('xt').some((topic) => topic.toLowerCase().startsWith('urn:btmh:'));
    throw onlyV2 ? new TorrentFailure('unsupported-format', V1_ONLY) : new TorrentFailure('invalid-magnet');
  }
}

function readInfoHash(source: Readonly<Record<string, unknown>>): Identified {
  const hashes = need<ClaimedHashes>(source.hashes, HASHES);
  if (hashes.v1 === undefined) throw hashes.v2 === undefined ? new TorrentFailure('invalid-infohash') : new TorrentFailure('unsupported-format', V1_ONLY);
  return { source: { kind: 'magnet', magnet: torrentMagnet(hashes.v1, '') }, infoHash: hashes.v1 };
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const isByte: Check = (value) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255;

/**
 * The bytes of a `.torrent` in any form a page can post: a typed array or buffer (what
 * structured clone carries), a list of byte values, or padded base64 text.
 */
function metainfoBytes(value: unknown): Uint8Array {
  const limit = TORRENT_CAPABILITIES.maxMetainfoBytes;
  if ((typeof value === 'string' || Array.isArray(value)) && value.length > limit * 2) throw new TorrentFailure('too-large');
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (listOf(isByte)(value)) return Uint8Array.from(value as number[]);
  if (typeof value === 'string' && BASE64.test(value)) return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  throw new TorrentFailure('invalid-source');
}

async function readMetainfo(source: Readonly<Record<string, unknown>>): Promise<Identified> {
  const bytes = metainfoBytes(source.metainfo);
  if (bytes.byteLength > TORRENT_CAPABILITIES.maxMetainfoBytes) throw new TorrentFailure('too-large');
  const metainfo = await readTorrentMetainfo(bytes).catch((error: Error) => {
    throw error.message.startsWith('invalid:metainfo-format') ? new TorrentFailure('unsupported-format', V1_ONLY) : new TorrentFailure('invalid-source');
  });
  const claimed = source.hashes === undefined ? { v1: metainfo.infoHash } : need<ClaimedHashes>(source.hashes, HASHES);
  if (claimed.v2 !== undefined || claimed.v1 !== metainfo.infoHash) throw new TorrentFailure('hash-mismatch');
  return { source: { kind: 'metainfo', bytes }, infoHash: metainfo.infoHash, title: metainfo.name.slice(0, MAX_TITLE_LENGTH) };
}

function readFileSet(): never {
  throw new TorrentFailure('unsupported-source', 'kernl cannot hand your files to your torrent program.');
}

const SOURCES: Readonly<Record<string, { readonly field: string; readonly read: (source: Readonly<Record<string, unknown>>) => Identified | Promise<Identified> }>> = {
  magnet: { field: 'magnet', read: readMagnet },
  infohash: { field: 'hashes', read: readInfoHash },
  metainfo: { field: 'metainfo', read: readMetainfo },
  'runtime-file-set': { field: 'runtimeFileSetId', read: readFileSet },
};

/** A `.torrent` may come with the hash the applet expects it to have; nothing else rides beside the selected field. */
function readSource(value: unknown): Identified | Promise<Identified> {
  const source = need<Record<string, unknown>>(value, { fields: { sourceType: isText, magnet: isAnything, hashes: isAnything, metainfo: isAnything, runtimeFileSetId: isAnything }, required: ['sourceType'], code: 'invalid-source' });
  const type = source.sourceType as string;
  const kind = Object.hasOwn(SOURCES, type) ? SOURCES[type] : undefined;
  const allowed = ['sourceType', kind?.field, type === 'metainfo' ? 'hashes' : undefined];
  const stray = Object.keys(source).some((key) => source[key] !== undefined && !allowed.includes(key));
  if (!kind || source[kind.field] === undefined || stray) throw new TorrentFailure('invalid-source');
  return kind.read(source);
}

interface AddOptions {
  readonly mode?: string;
  readonly transport?: string;
  readonly startPaused?: boolean;
  readonly seedAfterComplete?: boolean;
  readonly downloadLimitBytesPerSecond?: number;
  readonly uploadLimitBytesPerSecond?: number;
  readonly storage?: string;
  readonly trackers?: readonly string[];
  readonly webSeeds?: readonly string[];
  readonly fileSelection?: object;
  readonly retention?: TorrentRetention;
  readonly createFormat?: string;
}

const ADD_OPTIONS: Shape = {
  fields: {
    mode: oneOf(MODES),
    transport: isText,
    startPaused: isFlag,
    seedAfterComplete: isFlag,
    downloadLimitBytesPerSecond: isCount,
    uploadLimitBytesPerSecond: isCount,
    storage: oneOf(['temporary', 'persistent', 'user-selected']),
    trackers: listOf(isText),
    webSeeds: listOf(isText),
    fileSelection: isRecord,
    retention: oneOf(['session', 'persistent']),
    createFormat: oneOf(['v1', 'v2', 'hybrid']),
  },
};

/** The well-formed options kernl still has to turn down, first match wins. */
function refusedOption(options: AddOptions, mode: string): readonly [boolean, string, string?] | undefined {
  const refusals: readonly (readonly [boolean, string, string?])[] = [
    [mode === 'seed', 'unsupported-mode', 'kernl cannot hand your files to your torrent program.'],
    [!['auto', 'bittorrent'].includes(options.transport ?? 'auto'), 'unsupported-transport'],
    [(options.storage ?? 'persistent') !== 'persistent', 'storage-denied', 'Your torrent program chooses where files go.'],
    [options.trackers !== undefined || options.webSeeds !== undefined, 'unsupported-setting', 'Trackers and web seeds travel in the magnet link or the torrent file.'],
    [options.fileSelection !== undefined, 'unsupported', 'Choose files with selectFiles once the file list is known.'],
    [options.createFormat !== undefined, 'invalid-request'],
    [options.seedAfterComplete !== undefined && options.seedAfterComplete !== (mode === 'download-and-seed'), 'invalid-request'],
  ];
  return refusals.find(([refused]) => refused);
}

/**
 * Validates an `add` request down to what the program is handed. Nothing is sent
 * anywhere: a source is checked, bounded and identified here first.
 *
 * @param value - The request's `request` field.
 * @returns The plan.
 * @throws A {@link TorrentFailure} naming the first thing wrong.
 * @example
 * ```ts
 * const plan = await planTorrentAdd({ source: { sourceType: 'infohash', hashes: { v1: 'ab'.repeat(20) } } });
 * plan.mode; // 'download'
 * ```
 */
export async function planTorrentAdd(value: unknown): Promise<TorrentAddPlan> {
  const request = need<{ source: unknown; jobId?: string; options?: unknown }>(value, { fields: { source: isRecord, jobId: isName, options: isRecord }, required: ['source'] });
  const options = need<AddOptions>(request.options ?? {}, ADD_OPTIONS);
  const identified = await readSource(request.source);
  const mode = options.mode ?? 'download';
  const refused = refusedOption(options, mode);
  if (refused) throw new TorrentFailure(refused[1], refused[2]);
  return definedFields({
    ...identified,
    jobId: request.jobId,
    mode: mode as TorrentServiceMode,
    retention: options.retention ?? 'session',
    startPaused: options.startPaused ?? false,
    downloadLimit: options.downloadLimitBytesPerSecond ?? 0,
    uploadLimit: options.uploadLimitBytesPerSecond ?? 0,
  });
}

/** A validated `update`. */
export interface TorrentUpdatePlan {
  readonly jobId: string;
  readonly expectedRevision: number;
  readonly downloadLimit?: number;
  readonly uploadLimit?: number;
  readonly seedAfterComplete?: boolean;
}

const PATCH: Shape = { fields: { downloadLimitBytesPerSecond: isCount, uploadLimitBytesPerSecond: isCount, seedAfterComplete: isFlag } };

/**
 * Validates an `update` request. A setting kernl cannot change, trackers and web seeds
 * among them, is `unsupported-setting`; a known setting with a bad value is `invalid-request`.
 *
 * @param value - The request's `request` field.
 * @returns The plan.
 * @throws A {@link TorrentFailure} naming the first thing wrong.
 * @example
 * ```ts
 * planTorrentUpdate({ jobId: 'tor-1', expectedRevision: 0, patch: { uploadLimitBytesPerSecond: 500000 } }).uploadLimit; // 500000
 * ```
 */
export function planTorrentUpdate(value: unknown): TorrentUpdatePlan {
  const request = need<{ jobId: string; expectedRevision: number; patch: Record<string, unknown> }>(value, {
    fields: { jobId: isText, expectedRevision: isCount, patch: isRecord },
    required: ['jobId', 'expectedRevision', 'patch'],
  });
  const names = Object.keys(request.patch);
  if (names.some((name) => !Object.hasOwn(PATCH.fields, name))) throw new TorrentFailure('unsupported-setting');
  const patch = need<{ downloadLimitBytesPerSecond?: number; uploadLimitBytesPerSecond?: number; seedAfterComplete?: boolean }>(request.patch, PATCH);
  if (names.length === 0) throw new TorrentFailure('invalid-request');
  return definedFields({
    jobId: request.jobId,
    expectedRevision: request.expectedRevision,
    downloadLimit: patch.downloadLimitBytesPerSecond,
    uploadLimit: patch.uploadLimitBytesPerSecond,
    seedAfterComplete: patch.seedAfterComplete,
  });
}

/** The files a `selectFiles` names, and the priority to give them. */
export interface TorrentSelectionPlan {
  readonly indexes: readonly number[];
  readonly paths: readonly string[];
  /** -1, 0 or 1, as the program takes it. */
  readonly priority?: number;
}

/**
 * Validates a file selection. It must name at least one file, by index or by path.
 *
 * @param value - The request's `selection` field.
 * @returns The files named and their priority, narrowed to low, normal or high.
 * @throws `invalid-request` when malformed or empty.
 * @example
 * ```ts
 * planTorrentSelection({ indexes: [0], priority: 7 }); // { indexes: [0], paths: [], priority: 1 }
 * ```
 */
export function planTorrentSelection(value: unknown): TorrentSelectionPlan {
  const selection = need<{ indexes?: number[]; paths?: string[]; priority?: number }>(value, { fields: { indexes: listOf(isCount), paths: listOf(isText), priority: Number.isSafeInteger } });
  const plan = { indexes: selection.indexes ?? [], paths: selection.paths ?? [] };
  if (plan.indexes.length + plan.paths.length === 0) throw new TorrentFailure('invalid-request');
  return selection.priority === undefined ? plan : { ...plan, priority: Math.sign(selection.priority) };
}

/** A validated `jobs` filter; an absent list lets everything through. */
export interface TorrentFilterPlan {
  readonly states?: readonly string[];
  readonly modes?: readonly string[];
}

/**
 * Validates the optional filter of a `jobs` request.
 *
 * @param value - The request's `filter` field.
 * @returns The filter.
 * @throws `invalid-request` when malformed.
 * @example
 * ```ts
 * planTorrentFilter({ states: ['seeding'] });
 * ```
 */
export function planTorrentFilter(value: unknown): TorrentFilterPlan {
  return need<TorrentFilterPlan>(value ?? {}, { fields: { states: listOf(oneOf(STATES)), modes: listOf(oneOf(MODES)) } });
}

/**
 * Validates the optional options of a `remove` request.
 *
 * @param value - The request's `options` field.
 * @returns Whether the applet asked for the downloaded data to go too.
 * @throws `invalid-request` when malformed.
 * @example
 * ```ts
 * wantsTorrentDataDeleted({ deleteData: true }); // true
 * ```
 */
export function wantsTorrentDataDeleted(value: unknown): boolean {
  return need<{ deleteData?: boolean }>(value ?? {}, { fields: { deleteData: isFlag } }).deleteData === true;
}
