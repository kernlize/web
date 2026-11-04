import { Subject } from 'rxjs';
import type { AclStateContainer, Capability } from '@kehto/runtime';
import type { CapabilityHooks } from '@kehto/shell';
import type { AppletIdentity, GrantRecord, Grants, StorageLike } from '../types.js';
import { createNamespacedStore } from '../persistence/store.js';
import { BASELINE_DOMAINS, capabilitiesForDomains } from './domain-capabilities.js';

const STORAGE_KEY = 'grants:v1';

interface StoredGrant {
  readonly dTag: string;
  readonly hash: string;
  readonly domains: readonly string[];
  readonly blocked: boolean;
}

/** Options for {@link createGrants}. */
export interface GrantsOptions {
  /** `bridge.runtime.aclState`; the live source of truth the runtime enforces. */
  readonly acl: AclStateContainer;
  readonly storage: StorageLike;
  /** Domains the shell can offer at all, from `buildShellCapabilities`. */
  readonly availableDomains: () => readonly string[];
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
 * posture. The per-identity record is persisted at `kernl:grants:v1`; the ACL
 * itself is persisted by kehto. Blocking an applet blocks it in the ACL and empties its
 * environment through {@link createEnvironmentResolver}.
 *
 * @param options - ACL container, storage and the live domain list.
 * @returns The grants surface.
 * @example
 * ```ts
 * const grants = createGrants({ acl: bridge.runtime.aclState, storage, availableDomains });
 * grants.allowDomain(identity, 'relay');
 * grants.get(identity)?.capabilities; // includes 'relay:read' and 'relay:write'
 * ```
 */
export function createGrants(options: GrantsOptions): KernlGrants {
  const store = createNamespacedStore(options.storage, 'kernl');
  const records = new Map<string, StoredGrant>(Object.entries(store.getJson<Record<string, StoredGrant>>(STORAGE_KEY, {})));
  const changes$ = new Subject<GrantRecord>();

  const persist = (): void => store.setJson(STORAGE_KEY, Object.fromEntries(records));

  function stored(identity: AppletIdentity): StoredGrant {
    return records.get(keyOf(identity)) ?? { dTag: identity.dTag, hash: identity.hash, domains: [], blocked: false };
  }

  function record(entry: StoredGrant): GrantRecord {
    return {
      identity: { dTag: entry.dTag, hash: entry.hash },
      domains: Object.freeze([...entry.domains]),
      capabilities: capabilitiesForDomains([...BASELINE_DOMAINS, ...entry.domains]),
      blocked: entry.blocked,
      stateQuotaBytes: options.acl.getStateQuota('', entry.dTag, entry.hash),
    };
  }

  function syncAcl(entry: StoredGrant): void {
    const wanted = new Set<Capability>(capabilitiesForDomains([...BASELINE_DOMAINS, ...entry.domains]));
    const held = options.acl.getEntry('', entry.dTag, entry.hash)?.capabilities ?? [];
    for (const capability of held) if (!wanted.has(capability)) options.acl.revoke('', entry.dTag, entry.hash, capability);
    for (const capability of wanted) options.acl.grant('', entry.dTag, entry.hash, capability);
    if (entry.blocked) options.acl.block('', entry.dTag, entry.hash);
    else options.acl.unblock('', entry.dTag, entry.hash);
    options.acl.persist();
  }

  function commit(entry: StoredGrant): GrantRecord {
    records.set(`${entry.dTag}:${entry.hash}`, entry);
    persist();
    syncAcl(entry);
    const result = record(entry);
    changes$.next(result);
    return result;
  }

  function setDomains(identity: AppletIdentity, domains: readonly string[]): void {
    commit({ ...stored(identity), domains: [...domains] });
  }

  return {
    list: () => [...records.values()].map(record),
    get: (identity) => {
      const entry = records.get(keyOf(identity));
      return entry ? record(entry) : undefined;
    },
    ensure: (identity) => commit(stored(identity)),
    allowDomain(identity, domain) {
      if (!options.availableDomains().includes(domain)) throw new Error('invalid:domain');
      const current = stored(identity).domains;
      if (!BASELINE_DOMAINS.includes(domain) && !current.includes(domain)) setDomains(identity, [...current, domain]);
    },
    revokeDomain(identity, domain) {
      if (BASELINE_DOMAINS.includes(domain)) throw new Error('denied:baseline-domain');
      const current = stored(identity).domains;
      if (current.includes(domain)) setDomains(identity, current.filter((entry) => entry !== domain));
    },
    block: (identity) => void commit({ ...stored(identity), blocked: true }),
    unblock: (identity) => void commit({ ...stored(identity), blocked: false }),
    setStateQuota(identity, bytes) {
      options.acl.setStateQuota('', identity.dTag, identity.hash, bytes);
      commit(stored(identity));
    },
    availableDomains: () => options.availableDomains(),
    baselineDomains: () => BASELINE_DOMAINS,
    changes$,
  };
}

/**
 * The `capabilities.resolveEnvironment` hook for the `ShellAdapter`.
 *
 * Each applet sees the baseline domains plus the domains the user allowed,
 * intersected with what the shell offers live. kehto intersects again with
 * its own availability set, so this hook can only narrow. A blocked applet
 * sees only `shell`, enough to finish the handshake and nothing more.
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
    const allowed = new Set(record?.blocked ? ['shell'] : [...grants.baselineDomains(), ...(record?.domains ?? [])]);
    return Object.freeze({
      domains: Object.freeze(available.domains.filter((domain) => allowed.has(domain))),
      services: Object.freeze(available.services.filter((service) => allowed.has(service))),
    });
  };
}
