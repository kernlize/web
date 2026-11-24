import type { CommonServiceOptions } from '@kehto/services';
import type { ISigner } from 'applesauce-signers';
import type { SigningConsent } from '../consent/handler.js';
import type { KernlNetwork, KernlNetworkParts } from '../kernl-network.js';
import { publishAccepted } from '../applesauce/relay-backend.js';
import { selectRelayTier } from '../applesauce/relay-hooks.js';
import { loadReplaceableQuietly } from '../applesauce/identity-providers.js';
import type { People } from '../people/person.js';
import type { Profiles } from '../profiles/profiles.js';
import { createCommonActions } from './common-actions.js';

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
 * const common = createCommonService({ planRelays, ...commonActionsFor(parts, network, consent) });
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
