import { withheldDomains } from '@kernlize/core';
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
  'config',
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
  baselineLoad ??= import('@kernlize/core').then((core) => (baseline = core.BASELINE_DOMAINS));
  return baselineLoad;
}

/** The baseline once {@link loadBaselineDomains} has settled; empty before. */
export const baselineDomains = (): readonly string[] => baseline;

interface StoredGrant {
  readonly domains: readonly string[];
  /** Domains the person kept beside messages (D-060); absent in records written before it existed. */
  readonly unsafe?: readonly string[];
  readonly blocked: boolean;
  readonly stateQuotaBytes: number;
}

const keyOf = (identity: AppletIdentity): string => `${identity.dTag}:${identity.hash}`;

/** A stored JSON value, or undefined when nothing usable is stored; the caller supplies its own defaults. */
export function readStored<T>(storage: StorageLike, key: string): T | undefined {
  const raw = storage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    storage.removeItem(key);
    return undefined;
  }
}

/** Grants kept in the host's storage; every mutation emits the new record. What is granted for now stays in memory (D-060). */
export function createPreviewGrants(storage: StorageLike): Grants {
  const records = new Map<string, StoredGrant>(Object.entries(readStored<Record<string, StoredGrant>>(storage, GRANTS_KEY) ?? {}));
  const temporary = new Map<string, StoredGrant>();
  const identities = new Map<string, AppletIdentity>();
  const changes$ = new Subject<GrantRecord>();

  const persist = (): void => storage.setItem(GRANTS_KEY, JSON.stringify(Object.fromEntries(records)));
  const kept = (stored: StoredGrant): readonly string[] => stored.unsafe ?? [];
  const emptyEntry = (): StoredGrant => ({ domains: [], blocked: false, stateQuotaBytes: DEFAULT_QUOTA_BYTES });

  const recordOf = (identity: AppletIdentity, stored: StoredGrant, isTemporary: boolean): GrantRecord => ({
    identity,
    domains: stored.domains,
    unsafe: kept(stored),
    capabilities: [],
    withheld: withheldDomains(stored.domains, baselineDomains(), kept(stored)),
    blocked: stored.blocked,
    temporary: isTemporary,
    stateQuotaBytes: stored.stateQuotaBytes,
  });


  /** Apply `change` to the stored entry when remembering, and to the one granted for now when there is one or when not remembering. */
  const update = (identity: AppletIdentity, change: (current: StoredGrant) => StoredGrant, remember = true): void => {
    const key = keyOf(identity);
    identities.set(key, identity);
    const before = records.get(key) ?? emptyEntry();
    const aside = temporary.get(key);
    const next = remember ? change(before) : before;
    const asideNext = remember ? (aside && change(aside)) : change(aside ?? before);
    if (!remember && asideNext === (aside ?? before)) return;
    if (remember) {
      records.set(key, next);
      persist();
    }
    if (asideNext) temporary.set(key, asideNext);
    changes$.next(recordOf(identity, asideNext ?? next, asideNext !== undefined));
  };

  const identityOf = (key: string): AppletIdentity => {
    const known = identities.get(key);
    if (known) return known;
    const [dTag = '', hash = ''] = key.split(':');
    return { dTag, hash };
  };

  const withDomain = (domain: string, unsafe: boolean | undefined) => (current: StoredGrant): StoredGrant => {
    const domains = current.domains.includes(domain) ? current.domains : [...current.domains, domain];
    const holds = kept(current).includes(domain);
    const keep = unsafe === true && !holds ? [...kept(current), domain] : unsafe === false && holds ? kept(current).filter((item) => item !== domain) : current.unsafe;
    return domains === current.domains && keep === current.unsafe ? current : { ...current, domains, ...(keep ? { unsafe: keep } : {}) };
  };

  const withoutDomain = (domain: string) => (current: StoredGrant): StoredGrant =>
    current.domains.includes(domain)
      ? { ...current, domains: current.domains.filter((item) => item !== domain), unsafe: kept(current).filter((item) => item !== domain) }
      : current;

  return {
    list: () => [...new Set([...records.keys(), ...temporary.keys()])].map((key) => recordOf(identityOf(key), (temporary.get(key) ?? records.get(key)) as StoredGrant, temporary.has(key))),
    get(identity) {
      const key = keyOf(identity);
      const stored = temporary.get(key) ?? records.get(key);
      return stored && recordOf(identity, stored, temporary.has(key));
    },
    allowDomain: (identity, domain, choice = {}) => update(identity, withDomain(domain, choice.unsafe), choice.remember ?? true),
    revokeDomain: (identity, domain, choice = {}) => update(identity, withoutDomain(domain), choice.remember ?? true),
    forgetTemporary(identity) {
      const key = keyOf(identity);
      if (!temporary.delete(key)) return;
      changes$.next(recordOf(identity, records.get(key) ?? emptyEntry(), false));
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
    set(tier, urls) {
      if (urls.some((url) => !/^wss?:\/\/\S+$/.test(url))) throw new Error('invalid:url');
      set({ ...tiers, [tier]: [...new Set(urls)] });
    },
    changes$,
  };
}
