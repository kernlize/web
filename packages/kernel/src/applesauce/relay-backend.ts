import { lastValueFrom, toArray } from 'rxjs';
import { createRelayPoolService, type DmRelayPool, type RelayPoolServiceOptions } from '@kehto/services';
import type { RelayOperationPlan, RelayPlanningServiceHandler } from '@kehto/runtime';
import type { NappletMessage, NostrEvent, NostrFilter } from '@napplet/core';
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
    async publishToRelays(relayUrls, event) {
      await publishAccepted(pool, [...relayUrls], event);
    },
    selectRelayTier: (filters) => selectRelayTier(tiers, filters),
    isAvailable: () => true,
  };
}

/** A direct `handleMessage` call has no approval to lose, so its signal never aborts. */
const UNCANCELLED = new AbortController().signal;

function kindOf(message: NappletMessage): number | undefined {
  const kind = (message as { event?: { kind?: unknown } }).event?.kind;
  return typeof kind === 'number' ? kind : undefined;
}

/**
 * kehto's relay service over the shared pool, with publishes planned by the
 * event's kind.
 *
 * kehto plans every relay operation before it runs and then publishes only to
 * the planned relays (`publishToRelays`), but its publish plan cannot see the
 * event. kernl's plan does, so a profile update is planned onto discovery
 * relays and the user's own, and a note onto the outbox plus the super tier,
 * as before. An applet's explicit relay hint is planned as kehto plans it.
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - Relay tiers used to route publishes and unhinted subscriptions.
 * @returns The `relay` service handler.
 * @example
 * ```ts
 * registry.relay = createAppletRelayService(pool, tiers);
 * registry.relay.planRelayOperation('w1', { type: 'relay.publish', id: '1', event: { kind: 0 } }).relayUrls;
 * ```
 */
export function createAppletRelayService(pool: ApplesaucePool, tiers: RelayTiers): RelayPlanningServiceHandler {
  const inner = createRelayPoolService(createAppletRelayBackend(pool, tiers));
  function planRelayOperation(windowId: string, message: NappletMessage): RelayOperationPlan {
    const plan = inner.planRelayOperation(windowId, message);
    const kind = kindOf(message);
    const relay = (message as { relay?: unknown }).relay;
    const hinted = typeof relay === 'string' && relay.length > 0;
    if (plan.operation === 'subscribe' || plan.operation === 'query' || hinted || kind === undefined) return plan;
    const relayUrls = Object.freeze([...new Set(selectRelayTier(tiers, [{ kinds: [kind] }]))]);
    return Object.freeze({ operation: plan.operation, relayUrls, localOnly: relayUrls.length === 0 });
  }
  return {
    ...inner,
    planRelayOperation,
    handleMessage(windowId, message, send) {
      inner.executeRelayOperation(windowId, message, planRelayOperation(windowId, message), UNCANCELLED, send);
    },
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
