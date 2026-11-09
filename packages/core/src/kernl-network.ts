import { map, takeUntil, type Observable } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';
import type { AccountManager } from 'applesauce-accounts';
import type { AddressPointerLoader } from 'applesauce-loaders/loaders';
import type { KernlOptions, RelayTiers } from './types.js';
import { isReadOnlyAccount } from './applesauce/auth-hooks.js';
import { createReplaceableLoader, lookupRelaysOf } from './applesauce/identity-providers.js';
import { connectEventCache, type ConnectedEventCache } from './cache/connect.js';
import { createProfiles, type Profiles } from './profiles/profiles.js';
import { createRelayDirectory, type RelayDirectory } from './relays/directory.js';
import { createAccountMailboxes, type AccountMailboxes } from './relays/mailboxes.js';

/** The parts of the shell that know people and servers: the event cache, the loader over it, profiles, mailboxes and the directory. */
export interface KernlNetwork {
  readonly eventCache: ConnectedEventCache;
  readonly replaceableLoader: AddressPointerLoader;
  readonly profiles: Profiles;
  readonly directory: RelayDirectory;
  readonly mailboxes: AccountMailboxes;
}

/** What {@link createKernlNetwork} composes over. */
export interface KernlNetworkParts {
  readonly eventStore: EventStore;
  readonly pool: RelayPool;
  readonly tiers: RelayTiers;
  readonly accounts: AccountManager;
  /** Completes the mailboxes' account stream when the shell is destroyed. */
  readonly destroyed$: Observable<void>;
}

/**
 * Compose the event cache, the replaceable loader that asks it first, the
 * profile service, the relay directory and the active account's mailboxes.
 * A read-only or signed-out session has no signer for the mailboxes, so a
 * save is refused with `denied:read-only` (D-029, D-030).
 *
 * @param options - The shell's options; `eventCache` opens the cache.
 * @param parts - The store, pool, tiers and accounts they share.
 * @returns The composed parts.
 * @example
 * ```ts
 * const network = createKernlNetwork(options, { eventStore, pool, tiers, accounts, destroyed$ });
 * network.profiles.card$(pubkey).subscribe(render);
 * ```
 */
export function createKernlNetwork(options: Pick<KernlOptions, 'eventCache'>, parts: KernlNetworkParts): KernlNetwork {
  const { eventStore, pool, tiers, accounts } = parts;
  const eventCache = connectEventCache(eventStore, options.eventCache);
  const replaceableLoader = createReplaceableLoader(eventStore, pool, tiers, eventCache.cacheRequest);
  const lookupRelays = (): string[] => lookupRelaysOf(tiers.get());
  const directory = createRelayDirectory({ pool });
  const mailboxes = createAccountMailboxes({
    store: eventStore,
    pool,
    pubkey$: accounts.active$.pipe(map((account) => account?.pubkey), takeUntil(parts.destroyed$)),
    lookupRelays,
    signer: () => (accounts.active && !isReadOnlyAccount(accounts.active) ? accounts.active.signer : undefined),
    directory,
  });
  const profiles = createProfiles({ store: eventStore, load: replaceableLoader, lookupRelays });
  return { eventCache, replaceableLoader, profiles, directory, mailboxes };
}
