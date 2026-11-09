import { filter, lastValueFrom, map, merge, switchMap, take, timer, toArray, type Observable, type OperatorFunction } from 'rxjs';
import {
  NappletResolutionError,
  openNappletArtifactCache,
  resolveNapplet,
  type NappletArtifactCache,
  type ResolveNappletOptions,
  type ResolvedNapplet,
} from '@kehto/nip/5d';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import type { AppletPointer, AppletSummary, RelayTiers } from '../types.js';
import { asFilters, type ApplesaucePool } from '../applesauce/relay-hooks.js';

/**
 * Milliseconds a blob server gets before the next one is tried.
 *
 * @example
 * ```ts
 * await fetch(`${server}/${sha256}`, { signal: AbortSignal.timeout(BLOB_TIMEOUT_MS) }); // 20 s per server
 * ```
 */
export const BLOB_TIMEOUT_MS = 20_000;

function filterFor(pointer: AppletPointer): NostrFilter {
  if (pointer.kind === 'event') return { ids: [pointer.id] };
  const filter: NostrFilter = { kinds: [pointer.eventKind], authors: [pointer.pubkey] };
  if (pointer.identifier !== '') filter['#d'] = [pointer.identifier];
  return filter;
}

/**
 * How long a manifest lookup waits, in milliseconds.
 *
 * `settleMs` runs from the first manifest, so a slower relay holding a newer
 * release can still answer. `patienceMs` runs from the first relay that
 * answers with nothing, so a slower relay that does hold the applet is not cut
 * off. `timeoutMs` bounds a round of asking when no relay answers at all; a
 * lookup is at most two rounds. `retryDelayMs` is the pause before a round
 * whose relays all refused at once is asked a second time.
 */
export interface ManifestTiming {
  readonly settleMs: number;
  readonly patienceMs: number;
  readonly timeoutMs: number;
  readonly retryDelayMs: number;
}

/**
 * The waits {@link fetchManifestEvent} uses unless told otherwise.
 *
 * @example
 * ```ts
 * MANIFEST_TIMING.timeoutMs; // 10000: the longest one round of asking can take
 * await fetchManifestEvent(pool, tiers, pointer, { patienceMs: 2_000 });
 * ```
 */
export const MANIFEST_TIMING: ManifestTiming = Object.freeze({ settleMs: 3_000, patienceMs: 8_000, timeoutMs: 10_000, retryDelayMs: 1_000 });


/**
 * Relay URLs worth dialling, each once and in one spelling. Hints inside a
 * pointer are text a stranger wrote, so one that is not a websocket URL is
 * dropped instead of failing the lookup.
 */
function dialable(urls: readonly string[]): string[] {
  const kept = new Map<string, string>();
  for (const url of urls) {
    if (!/^wss?:\/\//i.test(url) || !URL.canParse(url)) continue;
    const key = new URL(url).href;
    if (!kept.has(key)) kept.set(key, url);
  }
  return [...kept.values()];
}

/**
 * When the manifest request may stop before every relay has answered.
 *
 * applesauce's default stops three seconds after the first relay reports the
 * end of its stored events, found or not. A catalogue relay slower than a
 * general relay with nothing to say then loses the race and the applet reads
 * as missing. So the two cases get their own clocks: once a manifest is in,
 * the rest have `settleMs` to offer a newer one; once a relay has answered
 * with nothing, the rest have the longer `patienceMs` to do better. A relay
 * that accepts a connection and hangs up never answers either way, and
 * applesauce-relay 7 leaves it pending whatever `reconnect` or
 * `firstResponseTimeout` say, which is why the request also carries
 * `timeoutMs`.
 */
function settleManifestRequest(timing: ManifestTiming): OperatorFunction<{ type: string }, boolean> {
  const after = (messages: Observable<{ type: string }>, type: string, waitMs: number): Observable<number> =>
    messages.pipe(filter((message) => message.type === type), take(1), switchMap(() => timer(waitMs)));
  return (messages) => merge(after(messages, 'EVENT', timing.settleMs), after(messages, 'EOSE', timing.patienceMs)).pipe(map(() => true));
}

/** What one round of asking produced: the newest manifest, and whether any relay answered at all. */
interface Asked {
  readonly newest?: NostrEvent;
  readonly answered: boolean;
  /** True when every relay refused outright, as opposed to the round running out its clock in silence. */
  readonly refused?: boolean;
}

async function askOnce(pool: ApplesaucePool, relays: string[], filter: NostrFilter, waits: ManifestTiming): Promise<Asked> {
  const request = pool.request(relays, asFilters([filter]), { complete: settleManifestRequest(waits), timeout: waits.timeoutMs });
  try {
    const events = await lastValueFrom(request.pipe(toArray()), { defaultValue: [] });
    const newest = events.reduce<NostrEvent | undefined>((best, event) => (best && best.created_at >= event.created_at ? best : event), undefined);
    return newest ? { newest, answered: true } : { answered: true };
  } catch (error) {
    // Every relay failed, or none answered in time: the network could not say, which is not "no such applet".
    return { answered: false, refused: (error as Error).name !== 'TimeoutError' };
  }
}

/**
 * One round: ask the relays, and ask once more when every one of them refused
 * the connection. Busy public relays answer a websocket upgrade with 502 or
 * 503 for a moment and accept the next one, and applesauce-relay 7 fails a
 * relay on its first refused connection whatever `reconnect` says. A round
 * that ran out its clock is not asked again: it already waited.
 */
async function askRelays(pool: ApplesaucePool, relays: string[], filter: NostrFilter, waits: ManifestTiming): Promise<Asked> {
  const first = await askOnce(pool, relays, filter, waits);
  if (!first.refused) return first;
  await new Promise((resolve) => setTimeout(resolve, waits.retryDelayMs));
  return askOnce(pool, relays, filter, waits);
}

/**
 * Fetch the manifest event a pointer names.
 *
 * The relays the address names and the `apps` tier are asked first. When they
 * do not produce the manifest, whether because they do not hold it or because
 * none of them answered, the `super` tier is asked before giving up: a
 * manifest is an ordinary event, authors publish it to general relays too, and
 * an address that opens elsewhere should not fail here because one catalogue
 * relay had a bad minute. For addresses, the newest event wins, since a named
 * applet is an addressable event that its author replaces on every release. A
 * relay that is down, silent or hangs up does not fail the lookup while
 * another one answers, a round whose relays all refused at once is asked a
 * second time, and hints that are not relay URLs are ignored.
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - Relay tiers; `apps` is asked first, `super` as the fallback.
 * @param pointer - The decoded pointer.
 * @param timing - Overrides for {@link MANIFEST_TIMING}, applied to each round.
 * @returns The manifest event, unverified.
 * @throws `unavailable:manifest` when a relay answered and none had it, or
 * there was no relay to ask; `unavailable:network` when no relay answered.
 * @example
 * ```ts
 * const event = await fetchManifestEvent(pool, tiers, decodePointer('naddr1…'));
 * ```
 */
export async function fetchManifestEvent(pool: ApplesaucePool, tiers: RelayTiers, pointer: AppletPointer, timing: Partial<ManifestTiming> = {}): Promise<NostrEvent> {
  const config = tiers.get();
  const first = dialable([...pointer.relays, ...config.apps]);
  const rounds = [first, dialable([...first, ...config.super]).slice(first.length)].filter((relays) => relays.length > 0);
  const waits = { ...MANIFEST_TIMING, ...timing };
  const filter = filterFor(pointer);
  let answered = rounds.length === 0;
  for (const relays of rounds) {
    const asked = await askRelays(pool, relays, filter, waits);
    if (asked.newest) return asked.newest;
    answered ||= asked.answered;
  }
  throw new Error(answered ? 'unavailable:manifest' : 'unavailable:network');
}

/**
 * Fetch an artifact blob by trying each server in turn with a 20-second budget.
 *
 * Bytes are returned unverified; `resolveNapplet` hashes them. Gateways are
 * accelerators, never identity.
 *
 * @param sha256 - The blob hash, lowercase hex.
 * @param servers - Server base URLs from the manifest.
 * @param fetchImpl - The fetch to use; the global one by default.
 * @returns The bytes the first responsive server returned.
 * @throws `unavailable:blob` when every server failed.
 * @example
 * ```ts
 * const bytes = await defaultFetchBlob(hash, ['https://blossom.example']);
 * ```
 */
export async function defaultFetchBlob(sha256: string, servers: readonly string[], fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  for (const server of servers) {
    try {
      const response = await fetchImpl(`${server.replace(/\/+$/, '')}/${sha256}`, { signal: AbortSignal.timeout(BLOB_TIMEOUT_MS) });
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
    } catch {
      // The next server gets its turn; a dead gateway is not a verification failure.
    }
  }
  throw new Error('unavailable:blob');
}

/**
 * Reduce a verified napplet to what the shell shows before running it.
 *
 * @param resolved - The output of kehto's `resolveNapplet`.
 * @returns The summary; `requires` and `optional` are advisory, never grants.
 * @example
 * ```ts
 * summarize(resolved).identity; // { dTag: 'chat', hash: '…' }
 * ```
 */
export function summarize(resolved: ResolvedNapplet): AppletSummary {
  const { manifest } = resolved;
  const summary: AppletSummary = {
    identity: { dTag: resolved.dTag, hash: resolved.aggregateHash },
    title: manifest.title ?? (resolved.dTag || 'Untitled applet'),
    description: manifest.description ?? '',
    publisher: manifest.pubkey,
    requires: Object.freeze([...manifest.requires]),
    optional: Object.freeze([...(manifest.optional ?? [])]),
    archetypes: Object.freeze([...(manifest.archetypeSlugs ?? manifest.archetypes.map((entry) => entry.slug))]),
    manifest,
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    ...(manifest.source ? { source: manifest.source } : {}),
  };
  return summary;
}

/**
 * Open kehto's verified-artifact cache over Cache Storage when the page has
 * it, and nothing otherwise. Cached bytes are re-hashed on every read by
 * `resolveNapplet`, so the cache accelerates and never authenticates.
 *
 * @returns The cache, or undefined where Cache Storage is unavailable.
 * @example
 * ```ts
 * const cache = await openDefaultArtifactCache();
 * ```
 */
export async function openDefaultArtifactCache(): Promise<NappletArtifactCache | undefined> {
  if (typeof caches === 'undefined') return undefined;
  return openNappletArtifactCache({ cacheStorage: caches, requireStorageEstimate: false });
}

/** Inputs for {@link resolveApplet}. */
export interface ResolveAppletOptions {
  readonly event: NostrEvent;
  readonly fetchBlob: (sha256: string, servers: readonly string[]) => Promise<Uint8Array>;
  readonly cache?: NappletArtifactCache;
}

/** A verified applet: what to show and what to run. */
export interface ResolvedApplet {
  readonly summary: AppletSummary;
  /** The verified `index.html` text, before CSP and prelude insertion. */
  readonly indexHtml: string;
}

function reasonFor(error: NappletResolutionError): string {
  return error.code === 'blob-unavailable' ? 'unavailable:blob' : `invalid:${error.code}`;
}

/**
 * Verify a manifest event and its artifact through kehto's `resolveNapplet`.
 *
 * Resolution failures are rethrown with kernl's prefixed reasons: a missing
 * blob is `unavailable:blob`; a bad signature, manifest, hash or index is
 * `invalid:<code>` with kehto's code.
 *
 * @param options - Manifest event, blob fetcher and optional verified-artifact cache.
 * @returns The summary and verified index HTML.
 * @example
 * ```ts
 * const { summary, indexHtml } = await resolveApplet({ event, fetchBlob: defaultFetchBlob });
 * ```
 */
export async function resolveApplet(options: ResolveAppletOptions): Promise<ResolvedApplet> {
  const input: ResolveNappletOptions = { event: options.event, fetchBlob: options.fetchBlob };
  if (options.cache) input.cache = options.cache;
  try {
    const resolved = await resolveNapplet(input);
    return { summary: summarize(resolved), indexHtml: resolved.indexHtml };
  } catch (error) {
    if (error instanceof NappletResolutionError) throw new Error(reasonFor(error));
    throw error;
  }
}
