import { distinctUntilChanged, filter, map, Observable, share, switchMap, take, timer, type Subscription } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import { getDisplayName, getOutboxes, getProfileContent, getProfilePicture } from 'applesauce-core/helpers';
import type { NostrEvent } from '@napplet/core';
import { abbreviate } from '../consent/describe-change.js';

/** How a person is shown: their chosen name and picture, or a short key while none is known. */
export interface ProfileCard {
  readonly pubkey: string;
  /** Display name, then name, then the abbreviated key. */
  readonly name: string;
  /** An `https:` picture URL, never another scheme. */
  readonly picture?: string;
  readonly nip05?: string;
  readonly about?: string;
  /** Whether a profile event has been seen; false while the name is the abbreviated key. */
  readonly found: boolean;
}

/** A replaceable pointer the loader understands. */
export interface ProfilePointer {
  readonly kind: number;
  readonly pubkey: string;
  readonly relays?: string[];
}

/** Loads a replaceable event into the store; applesauce's address loader fits. */
export type ProfileLoader = (pointer: ProfilePointer) => Observable<NostrEvent>;

/** People's profiles, read from the shell's event store and loaded on demand. */
export interface Profiles {
  /** The card now, and again every time a newer profile arrives. Subscribing starts the lookup. */
  card$(pubkey: string): Observable<ProfileCard>;
  /** The card from what the store already holds, without asking anyone. */
  card(pubkey: string): ProfileCard;
}

/** Options for {@link createProfiles}. */
export interface ProfilesOptions {
  readonly store: EventStore;
  readonly load: ProfileLoader;
  /** Where to look besides the author's own servers; usually the discovery and general tiers. */
  readonly lookupRelays: () => readonly string[];
  /** How long an unwatched card keeps its subscription open, in milliseconds. */
  readonly keepAliveMs?: number;
}

const PROFILE_KIND = 0;
const MAILBOX_KIND = 10002;
const KEEP_ALIVE_MS = 60_000;
const HEX_KEY = /^[0-9a-f]{64}$/;

function safePicture(event: NostrEvent): string | undefined {
  const picture = getProfilePicture(event);
  return picture?.startsWith('https://') ? picture : undefined;
}

/**
 * Read a profile card from a profile event, or the placeholder for a key with none.
 *
 * @param pubkey - The person's hex key.
 * @param event - Their newest profile event, if any.
 * @returns The card.
 * @example
 * ```ts
 * toProfileCard(pubkey, undefined).name; // '3bf0c63f…'
 * toProfileCard(pubkey, profileEvent).name; // 'fiatjaf'
 * ```
 */
export function toProfileCard(pubkey: string, event: NostrEvent | undefined): ProfileCard {
  const fallback = abbreviate(pubkey);
  const content = event ? getProfileContent(event) : undefined;
  if (!event || !content) return Object.freeze({ pubkey, name: fallback, found: false });
  const name = getDisplayName(content)?.trim();
  const picture = safePicture(event);
  return Object.freeze({
    pubkey,
    name: name || fallback,
    found: true,
    ...(picture ? { picture } : {}),
    ...(content.nip05 ? { nip05: content.nip05 } : {}),
    ...(content.about ? { about: content.about } : {}),
  });
}

/**
 * The profile service the shell shows people through.
 *
 * A card subscription asks the lookup relays for the person's profile and
 * their relay list at once; when the relay list names servers the profile
 * was not found on, the profile is asked for there as well, because a
 * profile lives on its author's own servers first (NIP-65). Nothing gives
 * up on a timer: a profile that arrives late replaces the placeholder.
 *
 * @param options - The store, the loader and the lookup relays.
 * @returns Profile cards per key.
 * @example
 * ```ts
 * const profiles = createProfiles({ store, load: loader, lookupRelays: () => tiers.get().discovery });
 * profiles.card$(pubkey).subscribe((card) => (label.textContent = card.name));
 * ```
 */
export function createProfiles(options: ProfilesOptions): Profiles {
  const { store, load } = options;
  const keepAlive = options.keepAliveMs ?? KEEP_ALIVE_MS;
  const cards = new Map<string, Observable<ProfileCard>>();

  const lookup = (pubkey: string): Subscription => {
    const relays = [...options.lookupRelays()];
    const subscription = load({ kind: PROFILE_KIND, pubkey, relays }).subscribe({ error: () => undefined });
    // The author's own servers, once their list is known, for a profile the lookup relays do not hold.
    const outboxes = load({ kind: MAILBOX_KIND, pubkey, relays })
      .pipe(
        map((event) => getOutboxes(event).filter((url) => !relays.includes(url))),
        filter((urls) => urls.length > 0 && !store.getReplaceable(PROFILE_KIND, pubkey)),
        take(1),
        switchMap((urls) => load({ kind: PROFILE_KIND, pubkey, relays: urls })),
      )
      .subscribe({ error: () => undefined });
    subscription.add(outboxes);
    return subscription;
  };

  const watch = (pubkey: string): Observable<ProfileCard> =>
    new Observable<ProfileCard>((subscriber) => {
      const loading = HEX_KEY.test(pubkey) ? lookup(pubkey) : undefined;
      const updates = store
        .replaceable(PROFILE_KIND, pubkey)
        .pipe(
          map((event) => toProfileCard(pubkey, event)),
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        )
        .subscribe(subscriber);
      return () => {
        updates.unsubscribe();
        loading?.unsubscribe();
      };
    }).pipe(share({ resetOnRefCountZero: () => timer(keepAlive) }));

  return {
    card$(pubkey) {
      const key = pubkey.toLowerCase();
      let card = cards.get(key);
      if (!card) {
        card = watch(key);
        cards.set(key, card);
      }
      return card;
    },
    card: (pubkey) => toProfileCard(pubkey, store.getReplaceable(PROFILE_KIND, pubkey.toLowerCase())),
  };
}
