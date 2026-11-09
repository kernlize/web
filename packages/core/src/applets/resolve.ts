import { lastValueFrom, toArray } from 'rxjs';
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
import { addressOf } from '../catalog/entry.js';

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
 * Fetch the manifest event a pointer names from its relay hints plus the apps tier.
 *
 * For addresses, the newest event wins, since a named applet is an addressable
 * event that its author replaces on every release.
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - Relay tiers; the apps tier is always consulted.
 * @param pointer - The decoded pointer.
 * @returns The manifest event, unverified.
 * @throws `unavailable:manifest` when no relay returned one.
 * @example
 * ```ts
 * const event = await fetchManifestEvent(pool, tiers, decodePointer('naddr1…'));
 * ```
 */
export async function fetchManifestEvent(pool: ApplesaucePool, tiers: RelayTiers, pointer: AppletPointer): Promise<NostrEvent> {
  const relays = [...new Set([...pointer.relays, ...tiers.get().apps])];
  const events = await lastValueFrom(pool.request(relays, asFilters([filterFor(pointer)])).pipe(toArray()), { defaultValue: [] });
  const newest = events.reduce<NostrEvent | undefined>(
    (best, event) => (best && best.created_at >= event.created_at ? best : event),
    undefined,
  );
  if (!newest) throw new Error('unavailable:manifest');
  return newest;
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
 * @param address - The shareable address of the manifest event.
 * @returns The summary; `requires` and `optional` are advisory, never grants.
 * @example
 * ```ts
 * summarize(resolved, 'naddr1…').identity; // { dTag: 'chat', hash: '…' }
 * ```
 */
export function summarize(resolved: ResolvedNapplet, address: string): AppletSummary {
  const { manifest } = resolved;
  const summary: AppletSummary = {
    identity: { dTag: resolved.dTag, hash: resolved.aggregateHash },
    address,
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
  /** Relay hints carried in the summary's address. */
  readonly relays?: readonly string[];
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
    return { summary: summarize(resolved, addressOf(options.event, options.relays)), indexHtml: resolved.indexHtml };
  } catch (error) {
    if (error instanceof NappletResolutionError) throw new Error(reasonFor(error));
    throw error;
  }
}
