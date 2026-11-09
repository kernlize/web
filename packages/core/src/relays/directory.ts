import { auditTime, BehaviorSubject, isObservable, map, Subject, type Observable, type Subscription } from 'rxjs';
import type { RelayPool } from 'applesauce-relay';
import type { NostrEvent } from 'applesauce-core/helpers';
import {
  RELAY_DISCOVERY_KIND,
  getRelayDiscoveryAcceptedKinds,
  getRelayDiscoveryNetworkType,
  getRelayDiscoveryRequirements,
  getRelayDiscoveryRTT,
  getRelayDiscoverySupportedNIPs,
  getRelayDiscoveryTypes,
  getRelayDiscoveryURL,
} from 'applesauce-common/helpers';
import { relayUrls, toRelayUrl } from './publish-outcome.js';

/**
 * Servers that carry NIP-66 monitors' reports: the ones nostr.watch's own
 * client reads, plus the history server its monitors list in their relay lists.
 *
 * @example
 * ```ts
 * createRelayDirectory({ pool, relays: DEFAULT_MONITOR_RELAYS });
 * ```
 */
export const DEFAULT_MONITOR_RELAYS: readonly string[] = Object.freeze([
  'wss://relay.nostr.watch',
  'wss://relaypag.es',
  'wss://monitorlizard.nostr1.com',
  'wss://history.nostr.watch',
]);

/** What a suggestion is for: where the account is reached, where it writes, or where accounts' lists are looked up. */
export type SuggestPurpose = 'inbox' | 'outbox' | 'lookup';

/**
 * What the directory suggests when it knows nothing, per purpose. General
 * servers for inbox and outbox; servers that index profiles and server lists
 * for lookup.
 *
 * @example
 * ```ts
 * DEFAULT_SUGGESTIONS.lookup; // ['wss://purplepag.es', 'wss://user.kindpag.es', 'wss://indexer.coracle.social']
 * ```
 */
export const DEFAULT_SUGGESTIONS: Readonly<Record<SuggestPurpose, readonly string[]>> = Object.freeze({
  inbox: Object.freeze(['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']),
  outbox: Object.freeze(['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']),
  lookup: Object.freeze(['wss://purplepag.es', 'wss://user.kindpag.es', 'wss://indexer.coracle.social']),
});

/** One server as the monitors that watch it describe it. */
export interface RelayListing {
  /** The normalised server URL. */
  readonly url: string;
  /** How many distinct monitors reported on it within the directory's window. */
  readonly monitors: number;
  /** The newest report's `created_at`, in seconds. */
  readonly lastSeen: number;
  /** Mean connection time in milliseconds across the monitors that measured it. */
  readonly rttOpen?: number;
  /** Mean read time in milliseconds. */
  readonly rttRead?: number;
  /** Mean write time in milliseconds. */
  readonly rttWrite?: number;
  /** The newest report's network, such as `clearnet`. */
  readonly network?: string;
  /** Every NIP any monitor saw it support, ascending. */
  readonly nips: readonly number[];
  /** Every server type any monitor gave it, such as `PublicOutbox`. */
  readonly types: readonly string[];
  /** The newest report says it requires a login. */
  readonly requiresAuth: boolean;
  /** The newest report says it requires payment. */
  readonly requiresPayment: boolean;
  /** The newest report says it accepts writes only from some accounts. */
  readonly restrictedWrites: boolean;
}

/** Options for {@link RelayDirectory.suggest}. */
export interface SuggestOptions {
  readonly purpose: SuggestPurpose;
  /** Servers already chosen, left out of the answer. */
  readonly exclude?: readonly string[];
  /** How many to suggest; 3 by default, the middle of NIP-65's 2–4. */
  readonly limit?: number;
}

/** A live directory of monitored servers. */
export interface RelayDirectory {
  /** Every listing, best first, replayed to new subscribers and re-emitted at most every `throttleMs` while reports stream in. */
  readonly listings$: Observable<readonly RelayListing[]>;
  /** The listings as of now, best first. */
  listings(): readonly RelayListing[];
  /** Listings whose address matches what the person typed, best first. */
  search(text: string, limit?: number): readonly RelayListing[];
  /** Servers to suggest for a purpose, topped up from the fallback when the directory knows too few. */
  suggest(options: SuggestOptions): readonly RelayListing[];
  /** Open the streaming subscription. Does nothing when already open. */
  start(): void;
  /** Close it, keeping what was learned. */
  stop(): void;
}

/** The pool surface the directory needs. */
export type DirectoryPool = Pick<RelayPool, 'subscription'>;

/** Options for {@link createRelayDirectory}. */
export interface RelayDirectoryOptions {
  readonly pool: DirectoryPool;
  /** Servers to read reports from; {@link DEFAULT_MONITOR_RELAYS} by default. */
  readonly relays?: readonly string[] | Observable<readonly string[]>;
  /** How old a report may be, in seconds; two days by default. */
  readonly maxAgeSeconds?: number;
  /** The clock, in seconds. */
  readonly now?: () => number;
  /** What to suggest when the directory knows too few: one list for every purpose, or one per purpose. {@link DEFAULT_SUGGESTIONS} by default. */
  readonly fallback?: readonly string[] | Partial<Readonly<Record<SuggestPurpose, readonly string[]>>>;
  /** The least time between two emissions of `listings$`, in milliseconds; 250 by default. */
  readonly throttleMs?: number;
}

interface Built {
  readonly listings: readonly RelayListing[];
  readonly indexers: ReadonlySet<string>;
}

const TWO_DAYS = 2 * 24 * 60 * 60;
const HOUR = 3600;
const DEFAULT_LIMIT = 3;
const INDEX_KINDS = new Set(['0', '10002']);

function mean(values: readonly (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return known.length === 0 ? undefined : known.reduce((sum, value) => sum + value, 0) / known.length;
}

function openTime(listing: RelayListing): number {
  return listing.rttOpen ?? Infinity;
}

function byRtt(a: RelayListing, b: RelayListing): number {
  return openTime(a) - openTime(b);
}

/** Seen by more monitors first, then seen within a more recent hour, then quicker to connect. */
function rank(a: RelayListing, b: RelayListing): number {
  return b.monitors - a.monitors || Math.floor(b.lastSeen / HOUR) - Math.floor(a.lastSeen / HOUR) || byRtt(a, b) || a.url.localeCompare(b.url);
}

function listingFrom(url: string, reports: readonly NostrEvent[]): RelayListing {
  const newest = reports.reduce((best, event) => (event.created_at > best.created_at ? event : best));
  const requirements = getRelayDiscoveryRequirements(newest);
  const nips = new Set(reports.flatMap(getRelayDiscoverySupportedNIPs).map(Number).filter(Number.isInteger));
  const measured = {
    rttOpen: mean(reports.map((event) => getRelayDiscoveryRTT(event, 'open'))),
    rttRead: mean(reports.map((event) => getRelayDiscoveryRTT(event, 'read'))),
    rttWrite: mean(reports.map((event) => getRelayDiscoveryRTT(event, 'write'))),
    network: getRelayDiscoveryNetworkType(newest),
  };
  const known = Object.fromEntries(Object.entries(measured).filter(([, value]) => value !== undefined)) as Pick<RelayListing, keyof typeof measured>;
  return {
    url,
    monitors: reports.length,
    lastSeen: newest.created_at,
    ...known,
    nips: [...nips].sort((a, b) => a - b),
    types: [...new Set(reports.flatMap(getRelayDiscoveryTypes))],
    requiresAuth: requirements.includes('auth'),
    requiresPayment: requirements.includes('payment'),
    restrictedWrites: requirements.includes('writes'),
  };
}

function isIndexer(listing: RelayListing, reports: readonly NostrEvent[]): boolean {
  if (listing.nips.includes(65)) return true;
  if (listing.types.some((type) => type.toLowerCase().includes('indexer'))) return true;
  return reports.some((event) => getRelayDiscoveryAcceptedKinds(event).some((kind) => INDEX_KINDS.has(kind)));
}

function blocks(listing: RelayListing | undefined, purpose: SuggestPurpose): boolean {
  if (!listing) return false;
  if (listing.requiresAuth || listing.requiresPayment) return true;
  return purpose !== 'lookup' && listing.restrictedWrites;
}

function placeholder(url: string): RelayListing {
  return { url, monitors: 0, lastSeen: 0, nips: [], types: [], requiresAuth: false, requiresPayment: false, restrictedWrites: false };
}

function fallbackFor(fallback: RelayDirectoryOptions['fallback'], purpose: SuggestPurpose): string[] {
  if (Array.isArray(fallback)) return relayUrls(fallback);
  const lists = (fallback ?? {}) as Partial<Record<SuggestPurpose, readonly string[]>>;
  return relayUrls(lists[purpose] ?? DEFAULT_SUGGESTIONS[purpose]);
}

interface Query {
  readonly text: string;
  /** The person typed a scheme, so they are typing the address from its start. */
  readonly anchored: boolean;
}

function parseQuery(raw: string): Query {
  const lower = raw.trim().toLowerCase();
  const text = lower.replace(/^wss?:\/\//, '').replace(/\/+$/, '');
  return { text, anchored: text !== lower.replace(/\/+$/, '') };
}

/** 2 when the text starts the address or one of its words, 1 when it appears inside, 0 otherwise. */
function matchScore(url: string, query: Query): number {
  const address = url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
  if (address.startsWith(query.text)) return 2;
  if (query.anchored) return 0;
  if (address.split(/[.\-/]/).some((word) => word.startsWith(query.text))) return 2;
  return address.includes(query.text) ? 1 : 0;
}

/**
 * Create a directory of servers from NIP-66 monitors' reports (kind 30166).
 *
 * `start()` streams reports newer than `maxAgeSeconds` for the `clearnet`
 * network from the monitor servers; a browser cannot dial the other networks,
 * and NIP-66 says a report SHOULD carry its network, so the filter asks the
 * servers to leave the rest out. A server that ignores the filter is
 * re-checked here: a report naming another network is dropped, one naming none
 * is kept. Each monitor's newest report per server counts; listings fold them
 * across monitors. NIP-66 warns that a monitor may be wrong or hostile, so the
 * directory only ranks, completes and suggests: it never removes a server the
 * person chose, and with no report at all `suggest` answers from the fallback
 * (D-029).
 *
 * @param options - The pool, the monitor servers, the window, the clock and the fallback.
 * @returns A directory; call `start()` to begin streaming.
 * @example
 * ```ts
 * const directory = createRelayDirectory({ pool });
 * directory.start();
 * directory.search('damus');
 * directory.suggest({ purpose: 'inbox', exclude: current });
 * ```
 */
export function createRelayDirectory(options: RelayDirectoryOptions): RelayDirectory {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const maxAge = options.maxAgeSeconds ?? TWO_DAYS;
  const reports = new Map<string, Map<string, NostrEvent>>();
  const changed = new Subject<void>();
  let built: (Built & { readonly cutoff: number }) | undefined;
  let subscription: Subscription | undefined;

  function build(cutoff: number): Built & { readonly cutoff: number } {
    const listings: RelayListing[] = [];
    const indexers = new Set<string>();
    for (const [url, byMonitor] of reports) {
      const fresh = [...byMonitor.values()].filter((event) => event.created_at >= cutoff);
      if (fresh.length === 0) continue;
      const listing = listingFrom(url, fresh);
      listings.push(listing);
      if (isIndexer(listing, fresh)) indexers.add(url);
    }
    return { listings: listings.sort(rank), indexers, cutoff };
  }

  const current = (): Built => {
    const cutoff = now() - maxAge;
    if (built?.cutoff !== cutoff) built = build(cutoff);
    return built;
  };
  const listings$ = new BehaviorSubject<readonly RelayListing[]>([]);
  changed.pipe(auditTime(options.throttleMs ?? 250)).subscribe(() => listings$.next(current().listings));

  function ingest(event: NostrEvent): void {
    if (event.kind !== RELAY_DISCOVERY_KIND || event.created_at < now() - maxAge) return;
    const network = getRelayDiscoveryNetworkType(event);
    const url = toRelayUrl(getRelayDiscoveryURL(event) ?? '');
    if ((network !== undefined && network !== 'clearnet') || url === undefined) return;
    const byMonitor = reports.get(url) ?? new Map<string, NostrEvent>();
    const previous = byMonitor.get(event.pubkey);
    if (previous && previous.created_at >= event.created_at) return;
    byMonitor.set(event.pubkey, event);
    reports.set(url, byMonitor);
    built = undefined;
    changed.next();
  }

  function monitorRelays(): string[] | Observable<string[]> {
    const relays = options.relays ?? DEFAULT_MONITOR_RELAYS;
    return isObservable(relays) ? relays.pipe(map((list) => [...list])) : [...relays];
  }

  function suggest({ purpose, exclude = [], limit = DEFAULT_LIMIT }: SuggestOptions): readonly RelayListing[] {
    const { listings, indexers } = current();
    const skip = new Set(relayUrls(exclude));
    const known = new Map(listings.map((listing) => [listing.url, listing]));
    const chosen = listings.filter((listing) => !skip.has(listing.url) && !blocks(listing, purpose) && (purpose !== 'lookup' || indexers.has(listing.url)));
    const picked = chosen.slice(0, limit);
    for (const url of fallbackFor(options.fallback, purpose)) {
      if (picked.length >= limit) break;
      if (skip.has(url) || blocks(known.get(url), purpose) || picked.some((listing) => listing.url === url)) continue;
      picked.push(known.get(url) ?? placeholder(url));
    }
    return picked;
  }

  return {
    listings$: listings$.asObservable(),
    listings: () => current().listings,
    search(text, limit = 10) {
      const query = parseQuery(text);
      return current()
        .listings.map((listing) => ({ listing, score: matchScore(listing.url, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.listing.monitors - a.listing.monitors || byRtt(a.listing, b.listing))
        .slice(0, limit)
        .map((entry) => entry.listing);
    },
    suggest,
    start() {
      if (subscription && !subscription.closed) return;
      const filter = { kinds: [RELAY_DISCOVERY_KIND], '#n': ['clearnet'], since: now() - maxAge };
      subscription = options.pool.subscription(monitorRelays(), [filter]).subscribe({
        next: ingest,
        error: () => undefined,
      });
    },
    stop() {
      subscription?.unsubscribe();
      subscription = undefined;
    },
  };
}
