import { BehaviorSubject, Subject } from 'rxjs';
import type { AppletIdentity, GrantRecord, Grants, RelayTier, RelayTiers, StorageLike } from './contract';

const GRANTS_KEY = 'kernl:preview:grants:v1';
const RELAYS_KEY = 'kernl:preview:relays:v1';
const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024;

export const AVAILABLE_DOMAINS: readonly string[] = [
  'relay',
  'identity',
  'storage',
  'theme',
  'resource',
  'dm',
  'notify',
  'media',
  'upload',
  'intent',
  'keys',
  'fs',
  'llm',
];

let baseline: readonly string[] = [];
let baselineLoad: Promise<readonly string[]> | undefined;

/**
 * What every applet gets without asking, taken from the core itself so the preview's always-on
 * set is the live shell's (D-003). Imported on first use so the core stays out of the shell's
 * first chunk; the preview awaits it before it shows an applet or plans a mount.
 */
export function loadBaselineDomains(): Promise<readonly string[]> {
  baselineLoad ??= import('@kernl/core').then((core) => (baseline = core.BASELINE_DOMAINS));
  return baselineLoad;
}

/** The baseline once {@link loadBaselineDomains} has settled; empty before. */
export const baselineDomains = (): readonly string[] => baseline;

interface StoredGrant {
  readonly domains: readonly string[];
  readonly blocked: boolean;
  readonly stateQuotaBytes: number;
}

const keyOf = (identity: AppletIdentity): string => `${identity.dTag}:${identity.hash}`;

/** A stored JSON value, or undefined when nothing usable is stored; the caller supplies its own defaults. */
function readStored<T>(storage: StorageLike, key: string): T | undefined {
  const raw = storage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    storage.removeItem(key);
    return undefined;
  }
}

/** Grants kept in the host's storage; every mutation emits the new record. */
export function createPreviewGrants(storage: StorageLike): Grants {
  const records = new Map<string, StoredGrant>(Object.entries(readStored<Record<string, StoredGrant>>(storage, GRANTS_KEY) ?? {}));
  const identities = new Map<string, AppletIdentity>();
  const changes$ = new Subject<GrantRecord>();

  const persist = (): void => storage.setItem(GRANTS_KEY, JSON.stringify(Object.fromEntries(records)));

  const recordOf = (identity: AppletIdentity, stored: StoredGrant): GrantRecord => ({
    identity,
    domains: stored.domains,
    capabilities: [],
    blocked: stored.blocked,
    stateQuotaBytes: stored.stateQuotaBytes,
  });

  const update = (identity: AppletIdentity, change: (current: StoredGrant) => StoredGrant): void => {
    const key = keyOf(identity);
    identities.set(key, identity);
    const current = records.get(key) ?? { domains: [], blocked: false, stateQuotaBytes: DEFAULT_QUOTA_BYTES };
    const next = change(current);
    records.set(key, next);
    persist();
    changes$.next(recordOf(identity, next));
  };

  const identityOf = (key: string): AppletIdentity => {
    const known = identities.get(key);
    if (known) return known;
    const [dTag = '', hash = ''] = key.split(':');
    return { dTag, hash };
  };

  return {
    list: () => [...records].map(([key, stored]) => recordOf(identityOf(key), stored)),
    get(identity) {
      const stored = records.get(keyOf(identity));
      return stored && recordOf(identity, stored);
    },
    allowDomain(identity, domain) {
      update(identity, (current) => (current.domains.includes(domain) ? current : { ...current, domains: [...current.domains, domain] }));
    },
    revokeDomain(identity, domain) {
      update(identity, (current) => ({ ...current, domains: current.domains.filter((item) => item !== domain) }));
    },
    block: (identity) => update(identity, (current) => ({ ...current, blocked: true })),
    unblock: (identity) => update(identity, (current) => ({ ...current, blocked: false })),
    setStateQuota: (identity, bytes) => update(identity, (current) => ({ ...current, stateQuotaBytes: bytes })),
    availableDomains: () => AVAILABLE_DOMAINS,
    baselineDomains,
    changes$,
  };
}

type Tiers = Readonly<Record<RelayTier, readonly string[]>>;

const DEFAULT_TIERS: Tiers = {
  discovery: ['wss://purplepag.es'],
  apps: ['wss://relay.damus.io'],
  outbox: ['wss://nos.lol'],
  super: ['wss://relay.primal.net'],
};

/** Network tiers kept in the host's storage. The preview never connects to them. */
export function createPreviewRelays(storage: StorageLike): RelayTiers {
  const saved = readStored<Partial<Tiers>>(storage, RELAYS_KEY) ?? {};
  let tiers: Tiers = {
    discovery: saved.discovery ?? DEFAULT_TIERS.discovery,
    apps: saved.apps ?? DEFAULT_TIERS.apps,
    outbox: saved.outbox ?? DEFAULT_TIERS.outbox,
    super: saved.super ?? DEFAULT_TIERS.super,
  };
  const changes$ = new BehaviorSubject<Tiers>(tiers);
  const set = (next: Tiers): void => {
    tiers = next;
    storage.setItem(RELAYS_KEY, JSON.stringify(next));
    changes$.next(next);
  };
  return {
    get: () => tiers,
    add(tier, url) {
      const normalised = url.trim();
      if (!/^wss?:\/\/\S+$/.test(normalised)) throw new Error('invalid:url');
      if (tiers[tier].includes(normalised)) return;
      set({ ...tiers, [tier]: [...tiers[tier], normalised] });
    },
    remove(tier, url) {
      set({ ...tiers, [tier]: tiers[tier].filter((item) => item !== url) });
    },
    changes$,
  };
}
