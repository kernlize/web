import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';
import type { AccountManager } from 'applesauce-accounts';
import type { ISigner } from 'applesauce-signers';
import type { AddressPointerLoader } from 'applesauce-loaders/loaders';
import type { RelayTiers } from './types.js';
import type { People } from './people/person.js';
import { createReplaceableLoader, loadReplaceableQuietly } from './applesauce/identity-providers.js';
import type { ConnectedEventCache } from './cache/connect.js';
import type { Profiles } from './profiles/profiles.js';
import type { CommonServiceOptions } from '@kehto/services';
import type { SigningConsent } from './consent/handler.js';
import { publishAccepted } from './applesauce/relay-backend.js';
import { selectRelayTier } from './applesauce/relay-hooks.js';
import { createCommonActions } from './social/common-actions.js';

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
  readonly cacheRequest?: ConnectedEventCache['cacheRequest'];
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
export function commonActionsFor(parts: Omit<KernlNetworkParts, 'destroyed$'>, network: Pick<KernlNetwork, 'replaceableLoader'> & { readonly profiles: Profiles; readonly people: People; readonly signer: () => ISigner | undefined }, consent: SigningConsent): CommonServiceOptions {
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
