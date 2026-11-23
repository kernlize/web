import { map, type Observable } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import type { AccountManager } from 'applesauce-accounts';
import type { NostrEvent } from '@napplet/core';
import type { ServiceRegistry } from '@kehto/runtime';
import type { PlannedExtensions } from '../applets/plan.js';
import type { SigningConsent } from '../consent/handler.js';
import type { ApplesaucePool } from '../applesauce/relay-hooks.js';
import { isReadOnlyAccount } from '../applesauce/auth-hooks.js';
import { loadReplaceableQuietly } from '../applesauce/identity-providers.js';
import type { KernlNetwork } from '../kernl-network.js';
import type { AppletSummary, RelayTiers, StorageLike } from '../types.js';
import type { AnyKernlModule, KernelContext, ModuleInstance } from './module.js';

/**
 * Parts the kernel provides by id until they are modules of their own. A module may `require`
 * them and reach them with `use`; no module may take their ids.
 *
 * @example
 * ```ts
 * KERNEL_PARTS.includes('profiles'); // true
 * ```
 */
export const KERNEL_PARTS: readonly string[] = Object.freeze(['profiles', 'people']);

/**
 * Domains the kernel answers whatever modules are loaded, kehto's own (`shell`, `storage`, `inc`)
 * among them, and the ones kernl still answers itself until they become modules. A module that
 * answers one is refused, so it can neither replace nor shadow the kernel's answer (D-061).
 *
 * @example
 * ```ts
 * KERNEL_DOMAINS.includes('relay'); // true
 * ```
 */
export const KERNEL_DOMAINS: readonly string[] = Object.freeze([
  'shell', 'storage', 'inc', 'relay', 'identity', 'notify', 'link', 'outbox',
  'keys', 'resource', 'dm', 'cvm', 'webrtc', 'config', 'upload', 'intent', 'torrent', 'nzb', 'soulseek', 'media',
]);

/**
 * Domains kehto's runtime offers natively that kernl answers through a module. A shell without
 * the module withholds the domain, so it is neither offered nor in any applet's baseline (D-061).
 *
 * @example
 * ```ts
 * MODULE_NATIVE_DOMAINS; // ['theme']
 * ```
 */
export const MODULE_NATIVE_DOMAINS: readonly string[] = Object.freeze(['theme']);

/**
 * Refuse a module list before anything is built: a repeated id, an id the kernel uses, a
 * requirement nothing provides (`invalid:module-missing`), or one listed after the module that
 * needs it (`invalid:module-order`), since modules are set up in order.
 *
 * @param modules - The host's module list.
 * @param reserved - The shell's own member names.
 * @example
 * ```ts
 * checkModules([themeModule(), themeModule()], []); // throws invalid:module-duplicate:theme
 * ```
 */
export function checkModules(modules: readonly AnyKernlModule[], reserved: readonly string[]): void {
  const ids = new Set(modules.map((module) => module.id));
  const seen = new Set<string>();
  for (const module of modules) {
    if (seen.has(module.id)) throw new Error(`invalid:module-duplicate:${module.id}`);
    if (reserved.includes(module.id) || KERNEL_PARTS.includes(module.id)) throw new Error(`invalid:module-reserved:${module.id}`);
    for (const id of module.requires ?? []) {
      if (KERNEL_PARTS.includes(id) || seen.has(id)) continue;
      throw new Error(ids.has(id) ? `invalid:module-order:${id}` : `invalid:module-missing:${id}`);
    }
    seen.add(module.id);
  }
}

/** What the kernel builds a module's context from. */
export interface KernelContextParts {
  readonly eventStore: EventStore;
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  readonly storage: StorageLike;
  readonly accounts: AccountManager;
  readonly consent: SigningConsent;
  readonly network: Pick<KernlNetwork, 'profiles' | 'people' | 'replaceableLoader'>;
  readonly appletOf: (windowId: string) => AppletSummary | undefined;
}

/** The modules once set up: what they answer, what planning adds, their apis and their teardown. */
export interface ComposedModules {
  readonly services: Partial<ServiceRegistry>;
  readonly extensions: PlannedExtensions | undefined;
  readonly apis: Readonly<Record<string, unknown>>;
  /** Native domains no module answers; see {@link MODULE_NATIVE_DOMAINS}. */
  readonly unanswered: readonly string[];
  dispose(): void;
}

function contextFor(parts: KernelContextParts, use: KernelContext['use']): KernelContext {
  const { accounts } = parts;
  const pubkey$: Observable<string | undefined> = accounts.active$.pipe(map((account) => account?.pubkey));
  return {
    eventStore: parts.eventStore,
    pool: parts.pool,
    tiers: parts.tiers,
    storage: parts.storage,
    identity: {
      pubkey: () => accounts.active?.pubkey,
      pubkey$,
      canSign: () => !!accounts.active && !isReadOnlyAccount(accounts.active),
    },
    async sign(windowId, template) {
      const account = accounts.active;
      if (!account || isReadOnlyAccount(account)) throw new Error('denied:read-only');
      await parts.consent(windowId, template);
      return (await account.signer.signEvent(template)) as NostrEvent;
    },
    appletOf: parts.appletOf,
    loadReplaceable: (pointer) => loadReplaceableQuietly(parts.network.replaceableLoader, parts.tiers, pointer),
    use,
  };
}

/** Leave out what a module offers through prelude bindings when this kehto cannot render them (D-053). */
function offered(instance: ModuleInstance<unknown>, bindings: boolean): ModuleInstance<unknown> {
  if (!instance.extensions || bindings) return instance;
  const { extensions, ...rest } = instance;
  const services = Object.fromEntries(Object.entries(instance.services ?? {}).filter(([domain]) => !extensions.domains.includes(domain)));
  return { ...rest, services };
}

/**
 * Planning extensions from several sources as one: the domains in order, the bindings together.
 *
 * @param all - Each source's extensions, or undefined where it has none.
 * @returns The extensions, or undefined when no source has any.
 * @example
 * ```ts
 * mergeExtensions([downloads.extensions, composed.extensions]);
 * ```
 */
export function mergeExtensions(all: ReadonlyArray<PlannedExtensions | undefined>): PlannedExtensions | undefined {
  const present = all.filter((entry): entry is PlannedExtensions => entry !== undefined);
  if (present.length === 0) return undefined;
  return { domains: present.flatMap((entry) => entry.domains), bindings: Object.assign({}, ...present.map((entry) => entry.bindings)) };
}

/** Dispose each module, last loaded first; one that throws or rejects does not keep the rest open. */
function disposeAll(instances: readonly ModuleInstance<unknown>[]): void {
  for (const instance of [...instances].reverse()) {
    try {
      void Promise.resolve(instance.dispose?.()).catch(() => undefined);
    } catch {
      // A module's failure to close is its own; the shell is going away either way.
    }
  }
}

/**
 * Set up each module in order over one kernel context. `use` reads another module's api, or a
 * part the kernel provides, when it is called, so a module may keep it for later. A module that
 * answers a domain in {@link KERNEL_DOMAINS} is refused with `invalid:module-domain:<domain>`.
 * Whatever is refused, the modules already set up are disposed before the error is thrown.
 *
 * @param modules - The host's module list, already checked with {@link checkModules}.
 * @param parts - What the kernel builds each module's context from.
 * @param bindings - Whether kehto's prelude renders domain bindings here.
 * @returns The composed modules.
 * @example
 * ```ts
 * const composed = setupModules([themeModule(), socialModule()], parts, supportsDomainBindings());
 * Object.assign(registry, composed.services);
 * ```
 */
export function setupModules(modules: readonly AnyKernlModule[], parts: KernelContextParts, bindings: boolean): ComposedModules {
  const apis: Record<string, unknown> = {};
  const provided: Record<string, unknown> = { profiles: parts.network.profiles, people: parts.network.people };
  const use = <T>(id: string): T => {
    if (id in apis) return apis[id] as T;
    if (id in provided) return provided[id] as T;
    throw new Error(`invalid:module-missing:${id}`);
  };
  const context = contextFor(parts, use);
  const instances: ModuleInstance<unknown>[] = [];
  try {
    for (const module of modules) {
      const instance = offered(module.setup(context), bindings);
      const taken = Object.keys(instance.services ?? {}).find((domain) => KERNEL_DOMAINS.includes(domain));
      if (taken !== undefined) throw new Error(`invalid:module-domain:${taken}`);
      instances.push(instance);
      if (instance.api !== undefined) apis[module.id] = instance.api;
    }
  } catch (error) {
    disposeAll(instances);
    throw error;
  }
  const services: Partial<ServiceRegistry> = Object.assign({}, ...instances.map((instance) => instance.services ?? {}));
  return {
    services,
    extensions: mergeExtensions(instances.map((instance) => instance.extensions)),
    apis,
    unanswered: Object.freeze(MODULE_NATIVE_DOMAINS.filter((domain) => !(domain in services))),
    dispose: () => disposeAll(instances),
  };
}
