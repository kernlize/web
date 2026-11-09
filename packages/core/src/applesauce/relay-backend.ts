import { lastValueFrom, toArray } from 'rxjs';
import type { DmRelayPool, RelayPoolServiceOptions } from '@kehto/services';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import type { RelayTiers } from '../types.js';
import { asFilters, selectRelayTier, subscribeWithEose, type ApplesaucePool } from './relay-hooks.js';

/** The relay-pool shape kehto's outbox router consumes. Declared structurally so core needs no extra import. */
export interface OutboxRelayPoolLike {
  subscribe(filters: NostrFilter[], relayUrls: string[], callback: (item: NostrEvent | 'EOSE') => void): { unsubscribe(): void };
  publish(event: NostrEvent, relayUrls: string[]): Promise<Record<string, boolean>>;
  isAvailable(): boolean;
}

/**
 * Publish to every relay and succeed when any one accepts. A relay that refuses
 * or is unreachable is normal on an open network; only when none accepted is
 * the publish a failure, and then the reason names how many were tried (D-028).
 *
 * @param pool - The shared applesauce pool.
 * @param relays - Where to publish.
 * @param event - The signed event.
 * @returns How many relays accepted it.
 * @example
 * ```ts
 * await publishAccepted(pool, ['wss://a', 'wss://b'], event); // 1 when only one accepted
 * ```
 */
export async function publishAccepted(pool: ApplesaucePool, relays: string[], event: NostrEvent): Promise<number> {
  const responses = relays.length > 0 ? await pool.publish(relays, event) : [];
  const accepted = responses.filter((response) => response.ok).length;
  if (accepted === 0) throw new Error(`unavailable:not-accepted:0/${relays.length}`);
  return accepted;
}

async function publishTo(pool: ApplesaucePool, relays: string[], event: NostrEvent): Promise<Record<string, boolean>> {
  const responses = await pool.publish(relays, event);
  return Object.fromEntries(responses.map((response) => [response.from, response.ok]));
}

/**
 * Options for kehto's `createRelayPoolService` over the shared applesauce pool.
 *
 * Publishes go to the tier selected for the event's kind, so a profile update
 * lands on discovery relays and the user's own, and a note on the user's outbox
 * plus the super tier. A publish succeeds when any relay accepts it.
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - Relay tiers used to route publishes and unhinted subscriptions.
 * @returns Options for `createRelayPoolService`.
 * @example
 * ```ts
 * runtime.registerService('relay', createRelayPoolService(createAppletRelayBackend(pool, tiers)));
 * ```
 */
export function createAppletRelayBackend(pool: ApplesaucePool, tiers: RelayTiers): RelayPoolServiceOptions {
  return {
    subscribe(filters, callback, relayUrls) {
      const relays = relayUrls ?? selectRelayTier(tiers, filters);
      return subscribeWithEose(pool, relays, filters, (item) => callback(item, relays));
    },
    async publish(event) {
      await publishAccepted(pool, selectRelayTier(tiers, [{ kinds: [event.kind] }]), event);
    },
    selectRelayTier: (filters) => selectRelayTier(tiers, filters),
    isAvailable: () => true,
  };
}

/**
 * The relay pool a messaging backend reads and writes through, satisfying
 * kehto's `DmRelayPool` over the same shared applesauce pool.
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - Relay tiers used when a caller names no relays.
 * @returns A `DmRelayPool`.
 * @example
 * ```ts
 * const dmPool = createDmRelayPool(pool, tiers);
 * const history = await dmPool.query([{ kinds: [1059], '#p': [me] }]);
 * ```
 */
export function createDmRelayPool(pool: ApplesaucePool, tiers: RelayTiers): DmRelayPool {
  return {
    subscribe(filters, callback, relayUrls) {
      return subscribeWithEose(pool, relayUrls ?? selectRelayTier(tiers, filters), filters, callback);
    },
    async publish(event) {
      await publishAccepted(pool, selectRelayTier(tiers, [{ kinds: [event.kind] }]), event);
    },
    query(filters, relayUrls) {
      return lastValueFrom(pool.request(relayUrls ?? selectRelayTier(tiers, filters), asFilters(filters)).pipe(toArray()));
    },
    selectRelayTier: (filters) => selectRelayTier(tiers, filters),
    isAvailable: () => true,
  };
}

/**
 * The relay pool kehto's `createRelayPoolOutboxRouter` fans out through.
 *
 * @param pool - The shared applesauce pool.
 * @returns A pool with per-relay publish outcomes.
 * @example
 * ```ts
 * const router = createRelayPoolOutboxRouter({ relayPool: createOutboxRelayPool(pool), ... });
 * ```
 */
export function createOutboxRelayPool(pool: ApplesaucePool): OutboxRelayPoolLike {
  return {
    subscribe: (filters, relayUrls, callback) => subscribeWithEose(pool, relayUrls, filters, callback),
    publish: (event, relayUrls) => publishTo(pool, relayUrls, event),
    isAvailable: () => true,
  };
}
