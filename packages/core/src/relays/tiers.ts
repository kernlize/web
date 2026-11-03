import { BehaviorSubject } from 'rxjs';
import type { RelayTier, RelayTiers, StorageLike } from '../types.js';
import { createNamespacedStore } from '../persistence/store.js';

/** Relay URLs per tier, frozen. */
export type TierMap = Readonly<Record<RelayTier, readonly string[]>>;

/**
 * Where the shell looks when the user has configured nothing.
 *
 * @example
 * ```ts
 * DEFAULT_RELAY_TIERS.apps; // ['wss://relay.napplet.soy']
 * DEFAULT_RELAY_TIERS.outbox; // []
 * ```
 */
export const DEFAULT_RELAY_TIERS: TierMap = Object.freeze({
  discovery: ['wss://purplepag.es', 'wss://relay.nos.social'],
  apps: ['wss://relay.napplet.soy'],
  outbox: [],
  super: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'],
});

const TIERS: readonly RelayTier[] = ['discovery', 'apps', 'outbox', 'super'];
const STORAGE_KEY = 'relays:v1';

function freeze(tiers: Record<RelayTier, readonly string[]>): TierMap {
  return Object.freeze({
    discovery: Object.freeze([...tiers.discovery]),
    apps: Object.freeze([...tiers.apps]),
    outbox: Object.freeze([...tiers.outbox]),
    super: Object.freeze([...tiers.super]),
  });
}

function merge(base: TierMap, overrides: Partial<Record<RelayTier, readonly string[]>>): TierMap {
  const next = { ...base } as Record<RelayTier, readonly string[]>;
  for (const tier of TIERS) {
    const value = overrides[tier];
    if (Array.isArray(value)) next[tier] = value.filter((url) => typeof url === 'string');
  }
  return freeze(next);
}

function assertRelayUrl(url: string): void {
  if (!/^wss?:\/\/\S+$/.test(url)) throw new Error('invalid:relay-url');
}

/**
 * Create the relay tier configuration the shell and kehto both read.
 *
 * kehto's `RelayConfigHooks` knows `discovery`, `super` and `outbox`; kernl adds
 * `apps`, the tier that serves applet manifests. The configuration is persisted
 * at `kernl:relays:v1` and `changes$` replays the current value to new
 * subscribers so UI and adapters can share one source.
 *
 * @param storage - Where the user's relay choices are persisted.
 * @param defaults - Per-tier overrides applied over {@link DEFAULT_RELAY_TIERS} when nothing is persisted.
 * @returns The tier configuration.
 * @example
 * ```ts
 * const tiers = createRelayTiers(localStorage, { apps: ['wss://relay.example'] });
 * tiers.add('outbox', 'wss://relay.mine');
 * tiers.get().outbox; // ['wss://relay.mine']
 * ```
 */
export function createRelayTiers(storage: StorageLike, defaults: Partial<Record<RelayTier, readonly string[]>> = {}): RelayTiers {
  const store = createNamespacedStore(storage, 'kernl');
  const persisted = store.getJson<Partial<Record<RelayTier, readonly string[]>> | null>(STORAGE_KEY, null);
  const initial = persisted ? merge(DEFAULT_RELAY_TIERS, persisted) : merge(DEFAULT_RELAY_TIERS, defaults);
  const changes$ = new BehaviorSubject<TierMap>(initial);

  const update = (tier: RelayTier, urls: readonly string[]): void => {
    const next = freeze({ ...changes$.value, [tier]: urls });
    store.setJson(STORAGE_KEY, next);
    changes$.next(next);
  };

  return {
    get: () => changes$.value,
    add(tier, url) {
      assertRelayUrl(url);
      const current = changes$.value[tier];
      if (!current.includes(url)) update(tier, [...current, url]);
    },
    remove(tier, url) {
      const current = changes$.value[tier];
      if (current.includes(url)) update(tier, current.filter((entry) => entry !== url));
    },
    changes$,
  };
}
