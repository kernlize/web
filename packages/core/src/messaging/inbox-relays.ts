import { lastValueFrom } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import { kinds, mergeRelaySets, type NostrEvent } from 'applesauce-core/helpers';
import { getRelaysFromList } from 'applesauce-common/helpers/lists';
import type { AddressPointerLoader } from 'applesauce-loaders/loaders';
import type { RelayTiers } from '../types.js';

/** Resolves where a person reads their private messages. */
export type InboxRelays = (pubkey: string) => Promise<string[]>;

/**
 * Where to deliver to, or read from, a person's message inbox: the relays in
 * their kind 10050 list, loaded through the replaceable loader when the store
 * does not hold it, else the user's `outbox` and `super` tiers. The loader
 * completes empty when its relays fail, so a failed lookup also falls back.
 *
 * @param store - The shell's event store.
 * @param loader - The replaceable loader that fills the store on a miss.
 * @param tiers - Relay tiers; `discovery` is asked for the list, `outbox` and `super` are the fallback.
 * @returns A resolver from public key to relay URLs.
 * @example
 * ```ts
 * const inboxRelays = createInboxRelays(eventStore, loader, tiers);
 * await inboxRelays(pubkey); // ['wss://inbox.example'] or the outbox and super tiers
 * ```
 */
export function createInboxRelays(store: EventStore, loader: AddressPointerLoader, tiers: RelayTiers): InboxRelays {
  const load = async (pubkey: string): Promise<NostrEvent | undefined> => {
    const cached = store.getReplaceable(kinds.DirectMessageRelaysList, pubkey);
    if (cached) return cached;
    const pointer = { kind: kinds.DirectMessageRelaysList, pubkey, relays: [...tiers.get().discovery] };
    return lastValueFrom(loader(pointer), { defaultValue: undefined });
  };
  return async (pubkey) => {
    const list = await load(pubkey);
    const relays = list ? getRelaysFromList(list) : [];
    return relays.length > 0 ? relays : mergeRelaySets(tiers.get().outbox, tiers.get().super);
  };
}
