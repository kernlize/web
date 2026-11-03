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

async function publishTo(pool: ApplesaucePool, relays: string[], event: NostrEvent): Promise<Record<string, boolean>> {
  const responses = await pool.publish(relays, event);
  return Object.fromEntries(responses.map((response) => [response.from, response.ok]));
}

/**
 * Options for kehto's `createRelayPoolService` over the shared applesauce pool.
 *
 * Publishes go to the tier selected for the event's kind, so a profile update
 * lands on discovery relays and a note on the user's outbox plus the super tier.
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
      await pool.publish(selectRelayTier(tiers, [{ kinds: [event.kind] }]), event);
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
      await pool.publish(selectRelayTier(tiers, [{ kinds: [event.kind] }]), event);
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
