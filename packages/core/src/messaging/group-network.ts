import { lastValueFrom, toArray } from 'rxjs';
import type { NostrEvent } from 'applesauce-core/helpers';
import type { NostrNetworkInterface, PublishResponse } from '@internet-privacy/marmot-ts';
import type { NostrFilter } from '@napplet/core';
import { subscribeWithEose, type ApplesaucePool } from '../applesauce/relay-hooks.js';
import type { InboxRelays } from './inbox-relays.js';

const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

/**
 * The group library's view of the network, over the shell's one relay pool
 * (SOUL opinion 1). A publish no relay took answers with no acknowledgements
 * rather than throwing, so the library records the failure itself; a request
 * that fails answers with no events.
 *
 * @param pool - The shell's relay pool.
 * @param inboxRelays - Where a person reads their invitations.
 * @returns A `NostrNetworkInterface` for `MarmotClient`.
 * @example
 * ```ts
 * const network = createGroupNetwork(kernl.pool, inboxRelays);
 * await network.request(['wss://relay.example'], { kinds: [30443], authors: [alice] });
 * ```
 */
export function createGroupNetwork(pool: ApplesaucePool, inboxRelays: InboxRelays): NostrNetworkInterface {
  return {
    async publish(relays, event) {
      const results = await pool.publish(relays, event).catch(() => []);
      return Object.fromEntries(results.map((result): [string, PublishResponse] => [result.from, { from: result.from, ok: result.ok }]));
    },
    request(relays, filters) {
      return lastValueFrom(pool.request(relays, asArray(filters)).pipe(toArray())).catch((): NostrEvent[] => []);
    },
    subscription(relays, filters) {
      return {
        subscribe(observer) {
          return subscribeWithEose(pool, relays, asArray(filters) as NostrFilter[], (item) => {
            if (item !== 'EOSE') observer.next?.(item);
          });
        },
      };
    },
    getUserInboxRelays: inboxRelays,
  };
}
