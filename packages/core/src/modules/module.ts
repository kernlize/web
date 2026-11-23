import type { Observable } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import type { EventTemplate, NostrEvent } from '@napplet/core';
import type { ServiceRegistry } from '@kehto/runtime';
import type { PlannedExtensions } from '../applets/plan.js';
import type { ApplesaucePool } from '../applesauce/relay-hooks.js';
import type { AppletSummary, RelayTiers, StorageLike } from '../types.js';

/** The signed-in identity as a module sees it: who, and whether they can sign, never their signer. */
export interface ModuleIdentity {
  /** The active pubkey, or undefined while nobody is signed in. */
  pubkey(): string | undefined;
  /** The active pubkey as it changes. */
  readonly pubkey$: Observable<string | undefined>;
  /** Whether the active identity can sign; false while nobody is signed in. */
  canSign(): boolean;
}

/** A replaceable event to load into the shell's store from the network. */
export interface ReplaceablePointer {
  readonly kind: number;
  readonly pubkey: string;
  readonly identifier?: string;
}

/**
 * What the kernel hands a module at setup. Everything is the shell's own: one store, one pool, the
 * relay tiers, the host's storage. A module signs through {@link KernelContext.sign}, which puts a
 * write that replaces or erases the person's record to them first; it never holds a signer or
 * kehto's bridge (D-061). Accessors are read when called, so a module may keep them for later.
 */
export interface KernelContext {
  readonly eventStore: EventStore;
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  /** The host's storage. A module keeps its own keys under `kernl:<module id>:`. */
  readonly storage: StorageLike;
  readonly identity: ModuleIdentity;
  /**
   * Sign a template for a window, after the person's consent when it replaces or erases their
   * record. Rejects with `denied:read-only` when the identity cannot sign, before anyone is asked.
   */
  sign(windowId: string, template: EventTemplate): Promise<NostrEvent>;
  /** The verified applet a window runs, or undefined. */
  appletOf(windowId: string): AppletSummary | undefined;
  /** Load a replaceable event into the store from the cache and the lookup relays. Never rejects. */
  loadReplaceable(pointer: ReplaceablePointer): Promise<void>;
  /**
   * Another module's api, or a part the kernel provides (`profiles`, `people`). Throws
   * `invalid:module-missing:<id>` when nothing by that id is loaded.
   */
  use<T>(id: string): T;
}

/** What a module's setup returns. */
export interface ModuleInstance<Api = void> {
  /** The NAP domains this module answers, keyed by domain. An applet is offered only what some module answers. */
  readonly services?: Partial<ServiceRegistry>;
  /**
   * Domains kehto's prelude must be told about, with what each offers inside the applet. They
   * are offered only where the prelude renders bindings (`supportsDomainBindings`), as the
   * download domains are; elsewhere the module's services for them are left out.
   */
  readonly extensions?: PlannedExtensions;
  /** What appears on the shell as `kernl[id]`. */
  readonly api?: Api;
  /** Called when the shell is destroyed, in the reverse of the order modules were loaded. */
  dispose?(): void | Promise<void>;
}

/**
 * One opinion of the shell, which a host loads, leaves out or replaces (D-061).
 *
 * @example
 * ```ts
 * const clock: KernlModule<'clock', { now(): number }> = {
 *   id: 'clock',
 *   setup: () => ({ api: { now: () => Date.now() } }),
 * };
 * const kernl = createKernl({ host, modules: [...kernlModules(), clock] });
 * kernl.clock.now();
 * ```
 */
export interface KernlModule<Id extends string = string, Api = void> {
  readonly id: Id;
  /** Ids of modules or kernel parts that must be loaded with this one. */
  readonly requires?: readonly string[];
  setup(context: KernelContext): ModuleInstance<Api>;
}

/** A module of any id and api, as a list of them is typed. */
export type AnyKernlModule = KernlModule<string, unknown>;

/** The member one module adds to the shell, `{ [id]: api }`, or nothing for a module without an api. */
export type ModuleApiEntry<M> = M extends KernlModule<infer Id, infer Api> ? ([Api] extends [void] ? never : { readonly [P in Id]: Api }) : never;

/** Every member of a union, as one type. */
export type IntersectionOf<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;

/**
 * The members a module list adds to the shell: `kernl[id]` for each module with an api.
 *
 * @example
 * ```ts
 * type Apis = ModuleApis<[KernlModule<'clock', { now(): number }>]>; // { readonly clock: { now(): number } }
 * ```
 */
export type ModuleApis<M extends readonly AnyKernlModule[]> = IntersectionOf<ModuleApiEntry<M[number]>>;
