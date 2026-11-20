import type { NamespacedStore } from '../persistence/store.js';
import { NZB_LIMITS, type NzbErrorCode } from './nzb-wire.js';

const STORE_KEY = 'nzb-replay:v1';
const UNCERTAIN = 'This may have been carried out; check the download, then ask again with the same operation key';

/** What one mutation record is kept under (NAP-NZB, Mutation replay). */
export interface NzbReplayScope {
  readonly applet: string;
  /** The downloader's key in the shell. */
  readonly downloader: string;
  readonly operationKey: string;
}

/** How a mutation ended: the result it was answered with, or the error. */
export type NzbOutcome = { readonly result: Readonly<Record<string, unknown>> } | { readonly error: { readonly code: NzbErrorCode; readonly message: string } };

/** What is already on record under an operation key. */
export interface NzbReplayHit {
  /** True when the record was reserved for a different operation or different parameters. */
  readonly conflict: boolean;
  readonly replayUntil: number;
  /** The recorded outcome; `outcome_unknown` while the attempt is unresolved. */
  readonly outcome: NzbOutcome;
  /** The job handles the outcome names, which the applet must still own to be given it. */
  readonly jobIds: readonly string[];
}

/** The durable mutation records behind `add` and `control`. */
export interface NzbReplay {
  /** Drops records past their time, except those still being carried out. */
  prune(): void;
  /** What is on record under a key, compared with the digest of the request now made. */
  find(scope: NzbReplayScope, digest: string): NzbReplayHit | undefined;
  /** Writes the reservation, before any effect outside the shell. */
  reserve(scope: NzbReplayScope, digest: string): void;
  /** Writes that the downloader is about to be told, so a shell that dies now leaves the outcome uncertain. */
  dispatched(scope: NzbReplayScope): void;
  /** Writes the outcome; resolves with the record's new `replayUntil`. */
  settle(scope: NzbReplayScope, outcome: NzbOutcome, jobIds: readonly string[]): number;
  /** Drops a reservation whose work ended before the downloader was told anything. */
  release(scope: NzbReplayScope): void;
  /** Every job handle the applet's records still name. */
  referenced(applet: string): ReadonlySet<string>;
}

interface ReplayRecord {
  readonly applet: string;
  /** SHA-256 of the operation and its exact parameters; the parameters themselves are not kept. */
  readonly digest: string;
  readonly replayUntil: number;
  readonly dispatched: boolean;
  readonly jobIds: readonly string[];
  readonly outcome?: NzbOutcome;
}

type Loose = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const isText = (value: unknown): boolean => typeof value === 'string';

function soundOutcome(outcome: unknown): boolean {
  if (outcome === undefined) return true;
  if (!isObject(outcome)) return false;
  return isObject(outcome.result) || (isObject(outcome.error) && isText(outcome.error.code) && isText(outcome.error.message));
}

function sound(record: unknown): record is ReplayRecord {
  if (!isObject(record) || !Array.isArray(record.jobIds)) return false;
  return isText(record.applet) && isText(record.digest) && Number.isSafeInteger(record.replayUntil) && typeof record.dispatched === 'boolean' && record.jobIds.every(isText) && soundOutcome(record.outcome);
}

/**
 * The digest a mutation record is compared by: SHA-256 over the operation and its
 * validated parameters with object members in a fixed order, so member order does not
 * matter and nothing else is normalised (NAP-NZB, Mutation replay). The record keeps
 * only this digest, never the document or a password.
 *
 * @param operation - `add` or `control`.
 * @param request - The validated request, exactly as the applet sent it.
 * @returns Lowercase hexadecimal SHA-256.
 * @example
 * ```ts
 * await digestNzbRequest('control', { jobId, operationKey: 'pause-1', action: 'pause' });
 * ```
 */
export async function digestNzbRequest(operation: string, request: unknown): Promise<string> {
  const ordered = (_key: string, value: unknown): unknown => (isObject(value) ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1))) : value);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ operation, request }, ordered)));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The mutation records over the shell's store. A record is written before anything
 * outside the shell is touched and again before the downloader is told, so a shell
 * that dies in between finds a record with no outcome when it comes back and answers
 * `outcome_unknown` instead of sending the change a second time.
 *
 * @param store - The shell's namespaced store.
 * @param now - Whole seconds since the epoch.
 * @returns The replay records.
 * @example
 * ```ts
 * const replay = createNzbReplay(store, () => Math.floor(Date.now() / 1000));
 * replay.find({ applet: 'reader', downloader: 'nzbget', operationKey: 'add-1' }, digest); // undefined
 * ```
 */
export function createNzbReplay(store: NamespacedStore, now: () => number): NzbReplay {
  /** Records this shell is carrying out now; anything else without an outcome was left by a shell that is gone. */
  const active = new Map<string, ReplayRecord>();
  const keyOf = (scope: NzbReplayScope): string => JSON.stringify([scope.applet, scope.downloader, scope.operationKey]);
  const load = (): Map<string, ReplayRecord> => new Map(Object.entries(store.getJson<Loose | null>(STORE_KEY, null) ?? {}).filter((entry): entry is [string, ReplayRecord] => sound(entry[1])));
  const write = (key: string, record: ReplayRecord | undefined): void => {
    const records = load();
    if (record) records.set(key, record);
    else records.delete(key);
    store.setJson(STORE_KEY, Object.fromEntries(records));
  };
  const later = (replayUntil: number): number => Math.max(replayUntil, now() + NZB_LIMITS.replaySeconds);
  const advance = (key: string, change: Partial<ReplayRecord>): ReplayRecord => {
    const record = { ...(active.get(key) as ReplayRecord), ...change };
    active.set(key, record);
    write(key, record);
    return record;
  };
  const orphan = (key: string, record: ReplayRecord): ReplayRecord | undefined => {
    const left = record.dispatched ? { ...record, replayUntil: later(record.replayUntil), outcome: { error: { code: 'outcome_unknown' as const, message: UNCERTAIN } } } : undefined;
    write(key, left);
    return left;
  };
  return {
    prune() {
      const records = load();
      const kept = [...records].filter(([key, record]) => record.replayUntil > now() || active.has(key));
      if (kept.length < records.size) store.setJson(STORE_KEY, Object.fromEntries(kept));
    },
    find(scope, digest) {
      const key = keyOf(scope);
      const stored = load().get(key);
      const record = stored && !stored.outcome && !active.has(key) ? orphan(key, stored) : stored;
      if (!record) return undefined;
      const outcome = record.outcome ?? { error: { code: 'outcome_unknown', message: UNCERTAIN } };
      return { conflict: record.digest !== digest, replayUntil: record.replayUntil, outcome, jobIds: record.jobIds };
    },
    reserve(scope, digest) {
      const key = keyOf(scope);
      active.set(key, { applet: scope.applet, digest, replayUntil: later(0), dispatched: false, jobIds: [] });
      advance(key, {});
    },
    dispatched: (scope) => void advance(keyOf(scope), { dispatched: true }),
    settle(scope, outcome, jobIds) {
      const key = keyOf(scope);
      const { replayUntil } = advance(key, { outcome, jobIds, replayUntil: later((active.get(key) as ReplayRecord).replayUntil) });
      active.delete(key);
      return replayUntil;
    },
    release(scope) {
      active.delete(keyOf(scope));
      write(keyOf(scope), undefined);
    },
    referenced: (applet) => new Set([...load().values()].filter((record) => record.applet === applet).flatMap((record) => record.jobIds)),
  };
}
