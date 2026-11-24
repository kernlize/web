import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';
import type { AccountManager } from 'applesauce-accounts';
import type { AddressPointerLoader } from 'applesauce-loaders/loaders';
import type { RelayTiers } from './types.js';
import { createReplaceableLoader } from './applesauce/identity-providers.js';
import type { CacheLookup } from './cache-lookup.js';

/** The kernel's network parts: the replaceable loader and the active signer. */
export interface KernlNetwork {
  readonly replaceableLoader: AddressPointerLoader;
}

/** What {@link createKernlNetwork} composes over. */
export interface KernlNetworkParts {
  readonly eventStore: EventStore;
  readonly pool: RelayPool;
  readonly tiers: RelayTiers;
  readonly accounts: AccountManager;
  /** The cache module's lookup, asked before any relay; nothing is cached without it (D-030, D-062). */
  readonly cacheRequest?: CacheLookup['cacheRequest'];
}

/**
 * Compose the replaceable loader, which asks the cache module first when it
 * is loaded (D-030).
 *
 * @param parts - The store, pool, tiers and accounts they share.
 * @returns The composed parts.
 * @example
 * ```ts
 * const network = createKernlNetwork({ eventStore, pool, tiers, accounts });
 * network.replaceableLoader({ kind: 0, pubkey, relays }).subscribe();
 * ```
 */
export function createKernlNetwork(parts: KernlNetworkParts): KernlNetwork {
  const { eventStore, pool, tiers } = parts;
  return { replaceableLoader: createReplaceableLoader(eventStore, pool, tiers, parts.cacheRequest) };
}

