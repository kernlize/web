import { auditTime, catchError, EMPTY, from, lastValueFrom, map, merge, mergeAll, type Observable, scan, takeUntil, timer } from 'rxjs';
import { getSeenRelays, type Filter } from 'applesauce-core/helpers';
import { NAPPLET_KIND_NAMED, NAPPLET_KIND_ROOT } from '@kehto/nip/5d';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import type { RelayTiers } from '../types.js';
import { asFilters, type ApplesaucePool } from '../applesauce/relay-hooks.js';
import { newestEntries, toCatalogEntry, type CatalogEntry } from './entry.js';
import { DELETION_KIND, isWithdrawn, withdraw, type Withdrawals } from './withdrawn.js';

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
 * The longest the store keeps asking a relay that has not finished. Entries are
 * listed as they arrive, so this is the outer bound, not a wait (D-028).
 *
 * @example
 * ```ts
 * await loadCatalog(pool, tiers, { timeoutMs: CATALOG_TIMEOUT_MS }); // at most 30 s
 * ```
 */
export const CATALOG_TIMEOUT_MS = 30_000;

/**
 * How often, at most, the streamed catalogue emits while manifests pour in.
 *
 * @example
 * ```ts
 * streamCatalog(pool, tiers); // emits at most every CATALOG_EMIT_MS
 * ```
 */
export const CATALOG_EMIT_MS = 120;

/** Options for {@link loadCatalog}. */
export interface LoadCatalogOptions {
  /** Per-relay manifest limit; {@link CATALOG_LIMIT} by default. */
  readonly limit?: number;
  /** Only manifests from these publishers. */
  readonly publishers?: readonly string[];
  /** The outer bound on a relay that never finishes; {@link CATALOG_TIMEOUT_MS} by default. */
  readonly timeoutMs?: number;
  /** How often the stream emits at most; {@link CATALOG_EMIT_MS} by default. */
  readonly emitMs?: number;
  /** Manifests seen before, listed at once while the relays are asked for newer ones. */
  readonly cache?: (filters: Filter[]) => Promise<NostrEvent[]>;
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

function catalogFilters(options: LoadCatalogOptions): NostrFilter[] {
  const limit = options.limit ?? CATALOG_LIMIT;
  const authors = options.publishers ? { authors: [...options.publishers] } : {};
  return [
    { kinds: [NAPPLET_KIND_NAMED, NAPPLET_KIND_ROOT], limit, ...authors },
    { kinds: [DELETION_KIND], '#k': [String(NAPPLET_KIND_NAMED), String(NAPPLET_KIND_ROOT)], limit, ...authors },
  ];
}

interface Found {
  readonly listed: readonly { readonly event: NostrEvent; readonly entry: CatalogEntry }[];
  readonly withdrawn: Withdrawals;
}

function hintsFor(event: NostrEvent, relays: readonly string[]): readonly string[] {
  const seen = [...(getSeenRelays(event) ?? [])];
  return seen.length > 0 ? seen.slice(0, 2) : relays.slice(0, 2);
}

/**
 * Stream the applets published to the store's relays.
 *
 * Root and named manifests are fetched; pinned versions are reached by
 * pasting their address. A manifest its publisher deleted (NIP-09) is not
 * listed, even when a relay still serves it. The list is emitted again as manifests arrive, so
 * the first relay to answer fills the store while slower ones are still
 * talking. A relay that fails contributes nothing and never discards what
 * others sent; the stream completes when every relay has finished, or at
 * the outer bound.
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - The shell's relay tiers.
 * @param options - Limit, publisher filter and outer bound.
 * @returns The growing list, one entry per applet, newest first.
 * @example
 * ```ts
 * streamCatalog(pool, tiers).subscribe((entries) => render(searchCatalog(entries, { text: 'notes' })));
 * ```
 */
export function streamCatalog(pool: ApplesaucePool, tiers: RelayTiers, options: LoadCatalogOptions = {}): Observable<readonly CatalogEntry[]> {
  const relays = catalogRelays(tiers);
  const filters = asFilters(catalogFilters(options));
  const cached = options.cache ? from(options.cache(filters).catch(() => [])).pipe(mergeAll()) : EMPTY;
  const live = pool.request([...relays], filters).pipe(
    takeUntil(timer(options.timeoutMs ?? CATALOG_TIMEOUT_MS)),
    catchError(() => EMPTY),
  );
  const events = merge(cached, live);
  const found = events.pipe(
    scan((state: Found, event): Found => {
      if (event.kind === DELETION_KIND) return { ...state, withdrawn: withdraw(state.withdrawn, event) };
      const entry = toCatalogEntry(event, hintsFor(event, relays));
      return entry ? { ...state, listed: [...state.listed, { event, entry }] } : state;
    }, { listed: [], withdrawn: new Map() }),
  );
  const listed = (state: Found): readonly CatalogEntry[] => newestEntries(state.listed.filter(({ event }) => !isWithdrawn(event, state.withdrawn)).map(({ entry }) => entry));
  return found.pipe(auditTime(options.emitMs ?? CATALOG_EMIT_MS), map(listed));
}

/**
 * List the applets published to the store's relays, once every relay has
 * finished or the outer bound passed. Prefer {@link streamCatalog} for UI.
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
  return lastValueFrom(streamCatalog(pool, tiers, options), { defaultValue: Object.freeze([]) });
}
