import { map, takeUntil, type Observable } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';
import type { AccountManager } from 'applesauce-accounts';
import type { ISigner } from 'applesauce-signers';
import type { AddressPointerLoader } from 'applesauce-loaders/loaders';
import type { RelayTiers } from './types.js';
import { isReadOnlyAccount } from './applesauce/auth-hooks.js';
import type { People } from './people/person.js';
import { createReplaceableLoader, loadReplaceableQuietly, lookupRelaysOf } from './applesauce/identity-providers.js';
import type { ConnectedEventCache } from './cache/connect.js';
import type { Profiles } from './profiles/profiles.js';
import { createAccountFileServers, type AccountFileServers } from './files/file-servers.js';
import type { CommonServiceOptions } from '@kehto/services';
import type { SigningConsent } from './consent/handler.js';
import { publishAccepted } from './applesauce/relay-backend.js';
import { selectRelayTier } from './applesauce/relay-hooks.js';
import { createCommonActions } from './social/common-actions.js';

/** The parts of the shell that know servers: the loader and the file servers. */
export interface KernlNetwork {
  readonly replaceableLoader: AddressPointerLoader;
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
  /** Completes the file servers' account stream when the shell is destroyed. */
  readonly destroyed$: Observable<void>;
  /** The cache module's lookup, asked before any relay; nothing is cached without it (D-030, D-062). */
  readonly cacheRequest?: ConnectedEventCache['cacheRequest'];
}

/**
 * Compose the replaceable loader, which asks the cache module first when it
 * is loaded, and the active account's file servers. A read-only or
 * signed-out session has no signer for them, so a save is refused with
 * `denied:read-only` (D-030).
 *
 * @param parts - The store, pool, tiers and accounts they share.
 * @returns The composed parts.
 * @example
 * ```ts
 * const network = createKernlNetwork({ eventStore, pool, tiers, accounts, destroyed$ });
 * network.files.state$.subscribe(render);
 * ```
 */
export function createKernlNetwork(parts: KernlNetworkParts): KernlNetwork {
  const { eventStore, pool, tiers, accounts } = parts;
  const replaceableLoader = createReplaceableLoader(eventStore, pool, tiers, parts.cacheRequest);
  const lookupRelays = (): string[] => lookupRelaysOf(tiers.get());
  const signer = (): ISigner | undefined => (accounts.active && !isReadOnlyAccount(accounts.active) ? accounts.active.signer : undefined);
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
  return { replaceableLoader, files, signer };
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
export function commonActionsFor(parts: Omit<KernlNetworkParts, 'destroyed$'>, network: Pick<KernlNetwork, 'replaceableLoader' | 'signer'> & { readonly profiles: Profiles; readonly people: People }, consent: SigningConsent): CommonServiceOptions {
  const { eventStore, pool, tiers, accounts } = parts;
  return createCommonActions({
    store: eventStore,
    profiles: network.profiles,
    locate: network.people.locate,
    pubkey: () => accounts.active?.pubkey,
    signer: network.signer,
    consent,
    publish: (event) => publishAccepted(pool, selectRelayTier(tiers, [{ kinds: [event.kind] }]), event),
    loadFollows: (pubkey) => loadReplaceableQuietly(network.replaceableLoader, tiers, { kind: 3, pubkey }),
  });
}
