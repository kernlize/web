import { lastValueFrom, map, takeUntil, type Observable } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';
import type { AccountManager } from 'applesauce-accounts';
import type { ISigner } from 'applesauce-signers';
import type { AddressPointerLoader } from 'applesauce-loaders/loaders';
import type { KernlOptions, RelayTiers } from './types.js';
import { isReadOnlyAccount } from './applesauce/auth-hooks.js';
import { createReplaceableLoader, lookupRelaysOf } from './applesauce/identity-providers.js';
import { connectEventCache, type ConnectedEventCache } from './cache/connect.js';
import { createProfiles, type Profiles } from './profiles/profiles.js';
import { createRelayDirectory, type RelayDirectory } from './relays/directory.js';
import { createAccountMailboxes, type AccountMailboxes } from './relays/mailboxes.js';
import { createAccountFileServers, type AccountFileServers } from './files/file-servers.js';
import type { CommonServiceOptions } from '@kehto/services';
import type { SigningConsent } from './consent/handler.js';
import { publishAccepted } from './applesauce/relay-backend.js';
import { selectRelayTier } from './applesauce/relay-hooks.js';
import { createCommonActions } from './social/common-actions.js';

/** The parts of the shell that know people and servers: the event cache, the loader over it, profiles, mailboxes and the directory. */
export interface KernlNetwork {
  readonly eventCache: ConnectedEventCache;
  readonly replaceableLoader: AddressPointerLoader;
  readonly profiles: Profiles;
  readonly directory: RelayDirectory;
  readonly mailboxes: AccountMailboxes;
  readonly files: AccountFileServers;
  /** The active account's signer, or none for a read-only or signed-out session. */
  readonly signer: () => ISigner | undefined;
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
 * profile service, the relay directory, and the active account's mailboxes
 * and file servers.
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
  const signer = (): ISigner | undefined => (accounts.active && !isReadOnlyAccount(accounts.active) ? accounts.active.signer : undefined);
  const mailboxes = createAccountMailboxes({
    store: eventStore,
    pool,
    pubkey$: accounts.active$.pipe(map((account) => account?.pubkey), takeUntil(parts.destroyed$)),
    lookupRelays,
    signer,
    directory,
  });
  const profiles = createProfiles({ store: eventStore, load: replaceableLoader, lookupRelays });
  const files = createAccountFileServers({
    store: eventStore,
    pool,
    load: replaceableLoader,
    pubkey$: accounts.active$.pipe(map((account) => account?.pubkey), takeUntil(parts.destroyed$)),
    pubkey: () => accounts.active?.pubkey,
    lookupRelays,
    outboxes: () => tiers.get().outbox,
    signer,
  });
  return { eventCache, replaceableLoader, profiles, directory, mailboxes, files, signer };
}

/**
 * The social actions the shell offers applets, over the composed network:
 * profiles from the profile service, the account's follow list loaded before
 * it changes, writes signed through the signing gate and published to the
 * tier for their kind (D-035).
 *
 * @param parts - The store, pool, tiers and accounts.
 * @param network - The composed network.
 * @param consent - The shell's signing gate.
 * @returns Options for kehto's `createCommonService`.
 * @example
 * ```ts
 * createKernlServices({ ..., common: commonActionsFor(parts, network, consent) });
 * ```
 */
export function commonActionsFor(parts: Omit<KernlNetworkParts, 'destroyed$'>, network: Pick<KernlNetwork, 'profiles' | 'replaceableLoader' | 'signer'>, consent: SigningConsent): CommonServiceOptions {
  const { eventStore, pool, tiers, accounts } = parts;
  return createCommonActions({
    store: eventStore,
    profiles: network.profiles,
    pubkey: () => accounts.active?.pubkey,
    signer: network.signer,
    consent,
    publish: (event) => publishAccepted(pool, selectRelayTier(tiers, [{ kinds: [event.kind] }]), event),
    loadFollows: (pubkey) =>
      lastValueFrom(network.replaceableLoader({ kind: 3, pubkey, relays: lookupRelaysOf(tiers.get()) }), { defaultValue: undefined }).then(
        () => undefined,
        () => undefined,
      ),
  });
}
