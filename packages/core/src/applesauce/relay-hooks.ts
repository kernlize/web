import type { RelayPool } from 'applesauce-relay';
import { normalizeRelayUrl, type Filter } from 'applesauce-core/helpers';
import type { NappletMessageTarget, RelayPoolHooks, RelayPoolLike } from '@kehto/shell';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import { NAPPLET_KINDS } from '@kehto/nip/5d';
import type { RelayTiers } from '../types.js';

/** The slice of applesauce's `RelayPool` kernl adapts. Narrow so tests can supply a fake. */
export type ApplesaucePool = Pick<RelayPool, 'req' | 'request' | 'publish'>;

/** Replaceable kinds that live on the discovery tier. */
const DISCOVERY_KINDS: ReadonlySet<number> = new Set([0, 3, 10002]);
/** Applet manifests and the legacy catalogue kind. */
const APP_KINDS: ReadonlySet<number> = new Set([...NAPPLET_KINDS, 32267]);

/** A subscription that delivers events once each and signals the end of stored events. */
export interface EoseSubscription {
  unsubscribe(): void;
}

/**
 * View NAP filters as applesauce filters. The two types describe the same
 * NIP-01 object; applesauce adds an index signature for NIP-91 `&` tags that
 * the NAP type does not declare.
 *
 * @param filters - NAP filters.
 * @returns The same array typed for applesauce.
 * @example
 * ```ts
 * pool.request(relays, asFilters(filters));
 * ```
 */
export function asFilters(filters: NostrFilter[]): Filter[] {
  return filters as Filter[];
}

/**
 * Subscribe through the pool's raw `req` so the end of stored events is
 * observable: `EOSE` is reported once, after every relay has answered or
 * failed, and events are deduplicated by id because `req` does not.
 * applesauce's `subscription()` deduplicates but hides `EOSE`, which kehto's
 * relay service relies on to answer `relay.subscribe`.
 *
 * @param pool - The shared applesauce pool.
 * @param relays - Relay URLs to ask.
 * @param filters - Filters for the request.
 * @param callback - Receives each new event once, then `'EOSE'`.
 * @returns A handle that closes the subscription.
 * @example
 * ```ts
 * const sub = subscribeWithEose(pool, ['wss://relay.example'], [{ kinds: [1] }], (item) => {
 *   if (item !== 'EOSE') console.log(item.id);
 * });
 * sub.unsubscribe();
 * ```
 */
export function subscribeWithEose(
  pool: ApplesaucePool,
  relays: string[],
  filters: NostrFilter[],
  callback: (item: NostrEvent | 'EOSE') => void,
): EoseSubscription {
  const seen = new Set<string>();
  const waiting = new Set(relays.map(normalizeRelayUrl));
  let eoseSent = waiting.size === 0;
  if (eoseSent) callback('EOSE');
  const settle = (from: string): void => {
    waiting.delete(normalizeRelayUrl(from));
    if (eoseSent || waiting.size > 0) return;
    eoseSent = true;
    callback('EOSE');
  };
  const subscription = pool.req(relays, asFilters(filters)).subscribe((message) => {
    if (message.type === 'EVENT') {
      if (seen.has(message.event.id)) return;
      seen.add(message.event.id);
      callback(message.event as NostrEvent);
      return;
    }
    if (message.type !== 'OPEN') settle(message.from);
  });
  return { unsubscribe: () => subscription.unsubscribe() };
}

/**
 * Adapt the shared applesauce `RelayPool` to kehto's `RelayPoolLike`.
 *
 * @param pool - The one pool the shell owns (D-002).
 * @returns An object kehto's `RelayPoolHooks.getRelayPool` can return.
 * @example
 * ```ts
 * const like = createRelayPoolLike(pool);
 * like.subscription(['wss://relay.example'], [{ kinds: [1] }]).subscribe((item) => {});
 * ```
 */
export function createRelayPoolLike(pool: ApplesaucePool): RelayPoolLike {
  return {
    subscription(relayUrls, filters) {
      return {
        subscribe(observer) {
          return subscribeWithEose(pool, relayUrls, filters as NostrFilter[], observer);
        },
      };
    },
    request(relayUrls, filters) {
      return {
        subscribe(observer) {
          const subscription = pool.request(relayUrls, asFilters(filters as NostrFilter[])).subscribe({
            next: (event) => observer.next(event),
            complete: () => observer.complete(),
            error: () => observer.error(),
          });
          return { unsubscribe: () => subscription.unsubscribe() };
        },
      };
    },
    async publish(relayUrls, event) {
      await pool.publish(relayUrls, event as NostrEvent);
    },
  };
}

function kindsOf(filters: readonly NostrFilter[]): number[] | undefined {
  const kinds: number[] = [];
  for (const filter of filters) {
    if (!filter.kinds || filter.kinds.length === 0) return undefined;
    kinds.push(...filter.kinds);
  }
  return kinds;
}

function unique(urls: readonly string[]): string[] {
  return [...new Set(urls)];
}

/**
 * Choose the relay tier for a set of filters.
 *
 * Profiles, follow lists and relay lists come from the discovery tier; applet
 * manifests from the apps tier; everything else goes to the user's outbox
 * relays plus the super tier. A filter without kinds cannot be classified and
 * takes the general path.
 *
 * @param tiers - The current tier configuration.
 * @param filters - Filters about to be sent.
 * @returns Relay URLs, deduplicated.
 * @example
 * ```ts
 * selectRelayTier(tiers, [{ kinds: [0], authors: [pubkey] }]); // tiers.get().discovery
 * ```
 */
export function selectRelayTier(tiers: RelayTiers, filters: readonly NostrFilter[]): string[] {
  const config = tiers.get();
  const kinds = kindsOf(filters);
  if (kinds && kinds.length > 0) {
    if (kinds.every((kind) => DISCOVERY_KINDS.has(kind))) return unique(config.discovery);
    if (kinds.every((kind) => APP_KINDS.has(kind))) return unique(config.apps);
  }
  return unique([...config.super, ...config.outbox]);
}

/**
 * Build kehto's `RelayPoolHooks` over the shared applesauce pool.
 *
 * Scoped relays (one relay per window, the NIP-29 pattern) are kept minimal:
 * one open subscription per window, replaced on reopen, and events delivered
 * to the window's bound port as `relay.event` envelopes.
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - Relay tiers used for `selectRelayTier`.
 * @returns Hooks for `ShellAdapter.relayPool`.
 * @example
 * ```ts
 * const adapter: ShellAdapter = { relayPool: createRelayPoolHooks(pool, tiers), ... };
 * ```
 */
export function createRelayPoolHooks(pool: ApplesaucePool, tiers: RelayTiers): RelayPoolHooks {
  const like = createRelayPoolLike(pool);
  const tracked = new Map<string, () => void>();
  const scoped = new Map<string, { relayUrl: string; subscription: EoseSubscription }>();

  const closeScopedRelay = (windowId: string): void => {
    scoped.get(windowId)?.subscription.unsubscribe();
    scoped.delete(windowId);
  };

  return {
    getRelayPool: () => like,
    trackSubscription(subKey, cleanup) {
      tracked.get(subKey)?.();
      tracked.set(subKey, cleanup);
    },
    untrackSubscription(subKey) {
      tracked.get(subKey)?.();
      tracked.delete(subKey);
    },
    openScopedRelay(windowId: string, relayUrl: string, subId: string, filters: NostrFilter[], target: NappletMessageTarget) {
      closeScopedRelay(windowId);
      const subscription = subscribeWithEose(pool, [relayUrl], filters, (item) => {
        target.postMessage(item === 'EOSE' ? { type: 'relay.eose', subId } : { type: 'relay.event', subId, event: item });
      });
      scoped.set(windowId, { relayUrl, subscription });
    },
    closeScopedRelay,
    async publishToScopedRelay(windowId, event) {
      const entry = scoped.get(windowId);
      if (!entry) return false;
      try {
        await pool.publish([entry.relayUrl], event);
        return true;
      } catch {
        return false;
      }
    },
    selectRelayTier: (filters) => selectRelayTier(tiers, filters),
  };
}
