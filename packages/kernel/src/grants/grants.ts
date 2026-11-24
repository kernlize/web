import { Subject } from 'rxjs';
import type { AclStateContainer, Capability } from '@kehto/runtime';
import type { CapabilityHooks } from '@kehto/shell';
import type { AppletIdentity, GrantRecord, Grants, StorageLike } from '../types.js';
import { createNamespacedStore } from '../persistence/store.js';
import { BASELINE_DOMAINS } from './domain-capabilities.js';
import { capabilitiesInForce, domainsInForce, withheldDomains } from './message-isolation.js';

const STORAGE_KEY = 'grants:v1';

interface StoredGrant {
  readonly dTag: string;
  readonly hash: string;
  readonly domains: readonly string[];
  /** Domains the person chose to keep beside messages (D-060). Absent in records written before it existed. */
  readonly unsafe?: readonly string[];
  readonly blocked: boolean;
}

/** Options for {@link createGrants}. */
export interface GrantsOptions {
  /** `bridge.runtime.aclState`; the live source of truth the runtime enforces. */
  readonly acl: AclStateContainer;
  readonly storage: StorageLike;
  /** Domains the shell can offer at all, from `buildShellCapabilities`. */
  readonly availableDomains: () => readonly string[];
  /**
   * Baseline domains no loaded module answers. They are left out of every applet's baseline, so
   * an applet is never handed a domain nothing serves (D-061). None by default.
   */
  readonly unanswered?: () => readonly string[];
}

/** The grants surface plus the hook the shell calls when an applet is about to run. */
export interface KernlGrants extends Grants {
  /** Write this applet's record into the runtime ACL before it runs; returns the record. */
  ensure(identity: AppletIdentity): GrantRecord;
}

function keyOf(identity: AppletIdentity): string {
  return `${identity.dTag}:${identity.hash}`;
}

/**
 * User-facing grants over kehto's ACL state.
 *
 * The runtime ACL is restrictive (`aclDefaultPolicy`, D-020): an applet with
 * no entry holds nothing. kernl grants the baseline domains plus what the user
 * allowed, and revokes whatever the applet's entry holds beyond that, which
 * covers a domain the user took back and an entry kept from an earlier
 * posture. An applet that holds messages is sealed: only the domains that
 * cannot send what it read anywhere stay in force, and the rest are reported
 * as `withheld`, unless the person chose to keep one beside messages (D-046,
 * D-060). The per-identity record is persisted at `kernl:grants:v1`; the ACL
 * itself is persisted by kehto. Blocking an applet blocks it in the ACL and empties its
 * environment through {@link createEnvironmentResolver}.
 *
 * A change made with `remember: false` lives in memory beside the stored record, takes
 * precedence over it, and is never written; `forgetTemporary` drops it and puts the
 * stored record back in force (D-060).
 *
 * @param options - ACL container, storage and the live domain list.
 * @returns The grants surface.
 * @example
 * ```ts
 * const grants = createGrants({ acl: bridge.runtime.aclState, storage, availableDomains });
 * grants.allowDomain(identity, 'relay');
 * grants.get(identity)?.capabilities; // includes 'relay:read' and 'relay:write'
 * grants.allowDomain(identity, 'outbox', { remember: false }); // until grants.forgetTemporary(identity)
 * ```
 */
export function createGrants(options: GrantsOptions): KernlGrants {
  const store = createNamespacedStore(options.storage, 'kernl');
  const records = new Map<string, StoredGrant>(Object.entries(store.getJson<Record<string, StoredGrant>>(STORAGE_KEY, {})));
  /** What was granted for now: in memory only, and ahead of the stored record while it exists. */
  const temporary = new Map<string, StoredGrant>();
  const changes$ = new Subject<GrantRecord>();

  const persist = (): void => store.setJson(STORAGE_KEY, Object.fromEntries(records));
  const kept = (entry: StoredGrant): readonly string[] => entry.unsafe ?? [];
  const baseline = (): readonly string[] => {
    const unanswered = options.unanswered?.() ?? [];
    return unanswered.length === 0 ? BASELINE_DOMAINS : Object.freeze(BASELINE_DOMAINS.filter((domain) => !unanswered.includes(domain)));
  };

  function stored(identity: AppletIdentity): StoredGrant {
    return records.get(keyOf(identity)) ?? { dTag: identity.dTag, hash: identity.hash, domains: [], blocked: false };
  }

  /** The entry in force: what was granted for now, else what is stored. */
  function inForce(identity: AppletIdentity): StoredGrant {
    return temporary.get(keyOf(identity)) ?? stored(identity);
  }

  function record(entry: StoredGrant, isTemporary: boolean): GrantRecord {
    return {
      identity: { dTag: entry.dTag, hash: entry.hash },
      domains: Object.freeze([...entry.domains]),
      unsafe: Object.freeze([...kept(entry)]),
      capabilities: capabilitiesInForce(entry.domains, kept(entry), baseline()),
      withheld: withheldDomains(entry.domains, baseline(), kept(entry)),
      blocked: entry.blocked,
      temporary: isTemporary,
      stateQuotaBytes: options.acl.getStateQuota('', entry.dTag, entry.hash),
    };
  }

  function syncAcl(entry: StoredGrant, save = true): void {
    const wanted = new Set<Capability>(capabilitiesInForce(entry.domains, kept(entry), baseline()));
    const held = options.acl.getEntry('', entry.dTag, entry.hash)?.capabilities ?? [];
    for (const capability of held) if (!wanted.has(capability)) options.acl.revoke('', entry.dTag, entry.hash, capability);
    for (const capability of wanted) options.acl.grant('', entry.dTag, entry.hash, capability);
    if (entry.blocked) options.acl.block('', entry.dTag, entry.hash);
    else options.acl.unblock('', entry.dTag, entry.hash);
    // What is only granted for now must not reach the disk through kehto's own persistence.
    if (save) options.acl.persist();
  }

  /**
   * Apply `change` to the stored record when remembering, and to the one granted for now when
   * there is one or when not remembering. A change that alters nothing is not reported.
   */
  function write(identity: AppletIdentity, change: (entry: StoredGrant) => StoredGrant, remember = true): GrantRecord {
    const key = keyOf(identity);
    const before = stored(identity);
    const after = remember ? change(before) : before;
    const aside = temporary.get(key);
    const asideAfter = remember ? (aside && change(aside)) : change(aside ?? before);
    if (remember) {
      records.set(key, after);
      persist();
    }
    if (asideAfter) temporary.set(key, asideAfter);
    const entry = asideAfter ?? after;
    syncAcl(entry, remember);
    const result = record(entry, asideAfter !== undefined);
    changes$.next(result);
    return result;
  }

  /** Whether `change` would alter the entry in force, or the stored one when remembering. */
  const alters = (identity: AppletIdentity, change: (entry: StoredGrant) => StoredGrant, remember: boolean): boolean =>
    (remember ? [stored(identity), temporary.get(keyOf(identity))] : [inForce(identity)]).some((entry) => entry !== undefined && change(entry) !== entry);

  /** `unsafe` true keeps the domain beside messages, false drops that exception, and leaving it out leaves it as it is. */
  const withDomain = (domain: string, unsafe: boolean | undefined) => (entry: StoredGrant): StoredGrant => {
    const baseline = BASELINE_DOMAINS.includes(domain);
    const domains = baseline || entry.domains.includes(domain) ? entry.domains : [...entry.domains, domain];
    const holds = kept(entry).includes(domain);
    const keep = unsafe === true && !holds ? [...kept(entry), domain] : unsafe === false && holds ? kept(entry).filter((item) => item !== domain) : entry.unsafe;
    return domains === entry.domains && keep === entry.unsafe ? entry : { ...entry, domains, ...(keep ? { unsafe: keep } : {}) };
  };

  const withoutDomain = (domain: string) => (entry: StoredGrant): StoredGrant => {
    if (!entry.domains.includes(domain) && !kept(entry).includes(domain)) return entry;
    return { ...entry, domains: entry.domains.filter((item) => item !== domain), unsafe: kept(entry).filter((item) => item !== domain) };
  };

  function apply(identity: AppletIdentity, change: (entry: StoredGrant) => StoredGrant, remember: boolean): void {
    if (alters(identity, change, remember)) write(identity, change, remember);
  }

  return {
    list: () => [...new Set([...records.keys(), ...temporary.keys()])].map((key) => record((temporary.get(key) ?? records.get(key)) as StoredGrant, temporary.has(key))),
    get: (identity) => {
      const key = keyOf(identity);
      const entry = temporary.get(key) ?? records.get(key);
      return entry ? record(entry, temporary.has(key)) : undefined;
    },
    ensure: (identity) => write(identity, (entry) => entry),
    allowDomain(identity, domain, choice = {}) {
      if (!options.availableDomains().includes(domain)) throw new Error('invalid:domain');
      apply(identity, withDomain(domain, choice.unsafe), choice.remember ?? true);
    },
    revokeDomain(identity, domain, choice = {}) {
      // A baseline domain cannot be taken back, but one the person kept beside messages can be put back under the seal.
      if (BASELINE_DOMAINS.includes(domain) && !kept(inForce(identity)).includes(domain)) throw new Error('denied:baseline-domain');
      apply(identity, withoutDomain(domain), choice.remember ?? true);
    },
    forgetTemporary(identity) {
      if (!temporary.delete(keyOf(identity))) return;
      const entry = stored(identity);
      syncAcl(entry);
      changes$.next(record(entry, false));
    },
    block: (identity) => void write(identity, (entry) => ({ ...entry, blocked: true })),
    unblock: (identity) => void write(identity, (entry) => ({ ...entry, blocked: false })),
    setStateQuota(identity, bytes) {
      options.acl.setStateQuota('', identity.dTag, identity.hash, bytes);
      write(identity, (entry) => entry);
    },
    availableDomains: () => options.availableDomains(),
    baselineDomains: baseline,
    changes$,
  };
}

/**
 * The `capabilities.resolveEnvironment` hook for the `ShellAdapter`.
 *
 * Each applet sees the baseline domains plus the domains the user allowed,
 * intersected with what the shell offers live. kehto intersects again with
 * its own availability set, so this hook can only narrow. A blocked applet
 * sees only `shell`, enough to finish the handshake and nothing more. An
 * applet that holds messages sees only the domains that may go with them.
 *
 * @param grants - The grants surface the hook reads.
 * @returns The hook, ready for `adapter.capabilities.resolveEnvironment`.
 * @example
 * ```ts
 * const adapter: ShellAdapter = { ..., capabilities: { resolveEnvironment: createEnvironmentResolver(grants) } };
 * ```
 */
export function createEnvironmentResolver(grants: Grants): NonNullable<CapabilityHooks['resolveEnvironment']> {
  return (identity, available) => {
    const record = grants.get({ dTag: identity.dTag, hash: identity.aggregateHash });
    const allowed = new Set(record?.blocked ? ['shell'] : domainsInForce(record?.domains ?? [], grants.baselineDomains(), record?.unsafe ?? []));
    return Object.freeze({
      domains: Object.freeze(available.domains.filter((domain) => allowed.has(domain))),
      services: Object.freeze(available.services.filter((service) => allowed.has(service))),
    });
  };
}
