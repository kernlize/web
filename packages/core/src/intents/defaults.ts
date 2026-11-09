import { lastValueFrom, Subject, takeUntil, timer, toArray, type Observable } from 'rxjs';
import { verifyEvent } from 'applesauce-core/helpers';
import type { EventTemplate, NostrEvent } from '@napplet/core';
import type { RelayTiers, StorageLike } from '../types.js';
import { asFilters, type ApplesaucePool } from '../applesauce/relay-hooks.js';
import { createNamespacedStore } from '../persistence/store.js';
import { HANDLER_PREFERENCES_KIND, parseHandlerPreferences, preferenceTemplate, type HandlerPreferences } from './preferences.js';

/** Signs the shell's own preference events. Present only while the active account can sign. */
export type PreferenceSigner = (template: EventTemplate) => Promise<NostrEvent>;

/** What {@link createHandlerDefaults} needs. */
export interface HandlerDefaultsOptions {
  readonly storage: StorageLike;
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  /** The signed-in account's public key, if any. */
  readonly pubkey: () => string | undefined;
  readonly signer: () => PreferenceSigner | undefined;
  /** Seconds since the epoch. */
  readonly now?: () => number;
}

/** The user's handler choices: what this device remembers, and what their account published. */
export interface HandlerDefaults {
  /** This device's default for an archetype. */
  get(archetype: string): string | undefined;
  /** Every default this device remembers, by archetype. */
  all(): Readonly<Record<string, string>>;
  /**
   * Remember a default, or forget it with `undefined`. With `sync` on and an
   * account that can sign, the choice is also published as the user's
   * handler preference for the archetype.
   */
  set(archetype: string, catalogId: string | undefined): Promise<void>;
  /** The account's published preferences for an archetype, once loaded. */
  synced(archetype: string): HandlerPreferences | undefined;
  /** Read the signed-in account's published preferences from its relays. */
  load(): Promise<void>;
  /** Whether choices are published to the account. Off until the user turns it on. */
  readonly sync: boolean;
  setSync(on: boolean): void;
  /** The archetype whose defaults or published preferences just changed. */
  readonly changes$: Observable<string>;
}

const DEFAULTS_KEY = 'intent-defaults:v1';
/** Published preferences that have not arrived after this long are read on the next sign-in. */
const LOAD_TIMEOUT_MS = 8000;
const SYNC_KEY = 'intent-sync:v1';

/**
 * The relays a preference event is read from and written to: the user's
 * outbox, then the public relays (the spec's NIP-65 write relays, as the shell
 * knows them).
 *
 * @param tiers - The shell's relay tiers.
 * @returns Deduplicated relay URLs.
 * @example
 * ```ts
 * preferenceRelays(tiers); // ['wss://relay.mine', 'wss://relay.damus.io', …]
 * ```
 */
export function preferenceRelays(tiers: RelayTiers): readonly string[] {
  const { outbox, super: shared } = tiers.get();
  return [...new Set([...outbox, ...shared])];
}

function newestPerArchetype(events: readonly NostrEvent[], pubkey: string): Map<string, NostrEvent> {
  const newest = new Map<string, NostrEvent>();
  for (const event of events) {
    // The spec's rule: apply only events whose signature verifies and whose author is the user.
    if (event.kind !== HANDLER_PREFERENCES_KIND || event.pubkey !== pubkey || !verifyEvent(event)) continue;
    const archetype = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
    const current = newest.get(archetype);
    if (archetype && (!current || event.created_at > current.created_at)) newest.set(archetype, event);
  }
  return newest;
}

/**
 * Handler defaults over local storage and the account's kind-31129 events.
 *
 * Local defaults are kept at `kernl:intent-defaults:v1` and always win, as the
 * spec allows a shell's own preferences to select without prompting. Published
 * preferences are read for the signed-in account and used to rank and
 * pre-select handlers. Publishing is opt-in (`kernl:intent-sync:v1`), because
 * the archetype a user set preferences for is public.
 *
 * @param options - Storage, pool, tiers and the active account's key and signer.
 * @returns The defaults.
 * @example
 * ```ts
 * const defaults = createHandlerDefaults({ storage, pool, tiers, pubkey, signer });
 * await defaults.set('profile', 'nip5d:35129:…:profile-viewer');
 * ```
 */
export function createHandlerDefaults(options: HandlerDefaultsOptions): HandlerDefaults {
  const store = createNamespacedStore(options.storage, 'kernl');
  const local = new Map(Object.entries(store.getJson<Record<string, string>>(DEFAULTS_KEY, {})));
  const published = new Map<string, NostrEvent>();
  const changes$ = new Subject<string>();
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  let sync = store.getJson<boolean>(SYNC_KEY, false) === true;
  let loadedFor: string | undefined;

  async function publish(archetype: string, catalogId: string): Promise<void> {
    const sign = options.signer();
    const template = preferenceTemplate(published.get(archetype), archetype, catalogId, now());
    if (!sign || !template) return;
    const event = await sign(template);
    published.set(archetype, event);
    await options.pool.publish([...preferenceRelays(options.tiers)], event).catch(() => undefined);
  }

  return {
    get: (archetype) => local.get(archetype),
    all: () => Object.freeze(Object.fromEntries(local)),
    async set(archetype, catalogId) {
      if (catalogId === undefined) local.delete(archetype);
      else local.set(archetype, catalogId);
      store.setJson(DEFAULTS_KEY, Object.fromEntries(local));
      changes$.next(archetype);
      if (sync && catalogId !== undefined) await publish(archetype, catalogId);
    },
    synced: (archetype) => {
      const event = published.get(archetype);
      return event ? parseHandlerPreferences(event) : undefined;
    },
    async load() {
      const pubkey = options.pubkey();
      if (pubkey !== loadedFor) published.clear();
      loadedFor = pubkey;
      if (!pubkey) return;
      const request = options.pool.request([...preferenceRelays(options.tiers)], asFilters([{ kinds: [HANDLER_PREFERENCES_KIND], authors: [pubkey] }]));
      const events = await lastValueFrom(request.pipe(takeUntil(timer(LOAD_TIMEOUT_MS)), toArray()), { defaultValue: [] }).catch(() => []);
      for (const [archetype, event] of newestPerArchetype(events, pubkey)) {
        published.set(archetype, event);
        changes$.next(archetype);
      }
    },
    get sync() {
      return sync;
    },
    setSync(on) {
      sync = on;
      store.setJson(SYNC_KEY, on);
    },
    changes$: changes$.asObservable(),
  };
}
