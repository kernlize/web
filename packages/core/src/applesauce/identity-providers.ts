import { lastValueFrom, map } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import { getContacts, getInboxes, getOutboxes, getProfileContent } from 'applesauce-core/helpers';
import { createAddressLoader, type AddressPointerLoader } from 'applesauce-loaders/loaders';
import type { IdentityServiceOptions } from '@kehto/services';
import type { NostrEvent } from '@napplet/core';
import type { RelayTiers } from '../types.js';
import type { ApplesaucePool } from './relay-hooks.js';

/** The profile shape NAP-IDENTITY returns for `identity.getProfile`. */
export interface IdentityProfile {
  name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
}

/** Read/write flags per relay URL, as `identity.getRelays` reports them. */
export type RelayPermissions = Record<string, { read: boolean; write: boolean }>;

/** The host-backed lookups kehto's identity service accepts, plus the relay list for the signer wrapper. */
export interface IdentityProviders extends Pick<IdentityServiceOptions, 'getProfile' | 'getFollows' | 'getMutes' | 'getList' | 'getZaps' | 'getBlocked' | 'getBadges'> {
  getRelays(pubkey: string): Promise<RelayPermissions>;
}

/** Options for {@link createIdentityProviders}. */
export interface IdentityProviderOptions {
  /** Loads replaceable events the store does not hold yet. */
  readonly loader?: AddressPointerLoader;
}

const PROFILE = 0;
const FOLLOWS = 3;
const MUTES = 10000;
const RELAYS = 10002;

function profileFrom(event: NostrEvent): IdentityProfile | null {
  const content = getProfileContent(event);
  if (!content) return null;
  const profile: IdentityProfile = {};
  if (content.name) profile.name = content.name;
  if (content.display_name) profile.displayName = content.display_name;
  if (content.about) profile.about = content.about;
  if (content.picture) profile.picture = content.picture;
  if (content.banner) profile.banner = content.banner;
  if (content.nip05) profile.nip05 = content.nip05;
  if (content.lud16) profile.lud16 = content.lud16;
  if (content.website) profile.website = content.website;
  return profile;
}

function relaysFrom(event: NostrEvent): RelayPermissions {
  const inboxes = new Set(getInboxes(event));
  const outboxes = new Set(getOutboxes(event));
  const relays: RelayPermissions = {};
  for (const url of [...inboxes, ...outboxes]) relays[url] = { read: inboxes.has(url), write: outboxes.has(url) };
  return relays;
}

function mutedPubkeys(event: NostrEvent): string[] {
  return event.tags.filter((tag) => tag[0] === 'p' && typeof tag[1] === 'string').map((tag) => tag[1] as string);
}

/**
 * Host-backed identity lookups for kehto's `createIdentityService`.
 *
 * Profile, follows, relays and mutes are read from the shell's `EventStore`
 * and, on a miss, loaded once through an applesauce address loader that asks
 * the discovery tier. Lists, zaps, blocked keys and badges return the
 * spec-shaped empty value: kernl does not claim data it has not fetched.
 *
 * @param store - The shell's single event store.
 * @param pool - The shared applesauce pool.
 * @param tiers - Relay tiers; the discovery tier serves misses.
 * @param options - Loader override for tests.
 * @returns Lookup callbacks keyed as kehto's options expect.
 * @example
 * ```ts
 * const providers = createIdentityProviders(eventStore, pool, tiers);
 * runtime.registerService('identity', createIdentityService({ getSigner, ...providers }));
 * ```
 */
export function createIdentityProviders(store: EventStore, pool: ApplesaucePool, tiers: RelayTiers, options: IdentityProviderOptions = {}): IdentityProviders {
  const loader = options.loader ?? createAddressLoader((relays, filters) => pool.request(relays, filters), {
    eventStore: store,
    lookupRelays: tiers.changes$.pipe(map((config) => [...config.discovery])),
  });

  async function replaceable(kind: number, pubkey: string): Promise<NostrEvent | undefined> {
    const cached = store.getReplaceable(kind, pubkey);
    if (cached) return cached;
    const loaded = await lastValueFrom(loader({ kind, pubkey, relays: [...tiers.get().discovery] }), { defaultValue: undefined });
    return loaded ?? store.getReplaceable(kind, pubkey);
  }

  return {
    getProfile: async (pubkey) => {
      const event = await replaceable(PROFILE, pubkey);
      return event ? profileFrom(event) : null;
    },
    getFollows: async (pubkey) => {
      const event = await replaceable(FOLLOWS, pubkey);
      return event ? getContacts(event).map((pointer) => pointer.pubkey) : [];
    },
    getMutes: async (pubkey) => {
      const event = await replaceable(MUTES, pubkey);
      return event ? mutedPubkeys(event) : [];
    },
    getRelays: async (pubkey) => {
      const event = await replaceable(RELAYS, pubkey);
      return event ? relaysFrom(event) : {};
    },
    getList: () => [],
    getZaps: () => [],
    getBlocked: () => [],
    getBadges: () => [],
  };
}
