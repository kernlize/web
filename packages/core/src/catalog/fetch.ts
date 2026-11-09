import { lastValueFrom, takeUntil, timer, toArray } from 'rxjs';
import { NAPPLET_KIND_NAMED, NAPPLET_KIND_ROOT } from '@kehto/nip/5d';
import type { NostrFilter } from '@napplet/core';
import type { RelayTiers } from '../types.js';
import { asFilters, type ApplesaucePool } from '../applesauce/relay-hooks.js';
import { newestEntries, toCatalogEntry, type CatalogEntry } from './entry.js';

/**
 * How many manifests the store asks each relay for.
 *
 * @example
 * ```ts
 * await loadCatalog(pool, tiers, { limit: CATALOG_LIMIT });
 * ```
 */
export const CATALOG_LIMIT = 500;

/**
 * Milliseconds the store waits for relays before listing what has arrived.
 *
 * @example
 * ```ts
 * await loadCatalog(pool, tiers, { timeoutMs: CATALOG_TIMEOUT_MS }); // 8 s, then whatever came in
 * ```
 */
export const CATALOG_TIMEOUT_MS = 8000;

/** Options for {@link loadCatalog}. */
export interface LoadCatalogOptions {
  /** Per-relay manifest limit; {@link CATALOG_LIMIT} by default. */
  readonly limit?: number;
  /** Only manifests from these publishers. */
  readonly publishers?: readonly string[];
  /** How long to wait for relays; {@link CATALOG_TIMEOUT_MS} by default. */
  readonly timeoutMs?: number;
}

/**
 * The relays the store reads: the applet catalogue tier first, then the
 * public relays most publishers also write to.
 *
 * @param tiers - The shell's relay tiers.
 * @returns Deduplicated relay URLs.
 * @example
 * ```ts
 * catalogRelays(tiers); // ['wss://relay.napplet.soy', 'wss://relay.damus.io', …]
 * ```
 */
export function catalogRelays(tiers: RelayTiers): readonly string[] {
  const { apps, super: shared } = tiers.get();
  return Object.freeze([...new Set([...apps, ...shared])]);
}

/**
 * List the applets published to the store's relays.
 *
 * Root and named manifests are fetched; pinned versions are reached by
 * pasting their address. A relay that fails contributes nothing, and the
 * store lists what arrived within the time budget, so a dead or slow relay
 * never keeps the rest from showing.
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - The shell's relay tiers.
 * @param options - Limit and publisher filter.
 * @returns One entry per applet, newest first.
 * @example
 * ```ts
 * const entries = await loadCatalog(pool, tiers);
 * searchCatalog(entries, { text: 'notes' });
 * ```
 */
export async function loadCatalog(pool: ApplesaucePool, tiers: RelayTiers, options: LoadCatalogOptions = {}): Promise<readonly CatalogEntry[]> {
  const relays = catalogRelays(tiers);
  const filter: NostrFilter = { kinds: [NAPPLET_KIND_NAMED, NAPPLET_KIND_ROOT], limit: options.limit ?? CATALOG_LIMIT };
  if (options.publishers) filter.authors = [...options.publishers];
  const request = pool.request([...relays], asFilters([filter])).pipe(takeUntil(timer(options.timeoutMs ?? CATALOG_TIMEOUT_MS)), toArray());
  const events = await lastValueFrom(request, { defaultValue: [] }).catch(() => []);
  const entries: CatalogEntry[] = [];
  for (const event of events) {
    const entry = toCatalogEntry(event, relays.slice(0, 2));
    if (entry) entries.push(entry);
  }
  return newestEntries(entries);
}
