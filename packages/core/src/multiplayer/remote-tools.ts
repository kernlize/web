import type { ServiceHandler, ServiceRuntimeContext } from '@kehto/runtime';
import { createCvmService, type CvmRegistryFamily, type CvmService } from '@kehto/services';
import { createNostrCvmTransport, type CvmRelayPool } from '@kehto/services/cvm-nostr-transport';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import { publishAccepted } from '../applesauce/relay-backend.js';
import { subscribeWithEose, type ApplesaucePool } from '../applesauce/relay-hooks.js';
import type { WindowIdentities } from './window-identities.js';

/** What the remote tools service needs from the shell. */
export interface RemoteToolsOptions {
  readonly pool: ApplesaucePool;
  /** Where a tool server is looked for when the applet names no relay for it; read when a window first calls one. */
  readonly relays: () => readonly string[];
  readonly identities: WindowIdentities;
  /** Tool families the host and the person vouch for, pinned to verified schemas; read when a window first calls one. */
  readonly registry?: () => readonly CvmRegistryFamily[];
}

/**
 * The host's tool families and the person's together. The person's family
 * takes the place of the host's with the same label and provider, so what
 * they chose is what an applet asking by that label reaches (D-043).
 *
 * @param host - Families from `KernlOptions.remoteTools.registry`.
 * @param own - Families the person trusts.
 * @returns The families the tool service offers.
 * @example
 * ```ts
 * mergeFamilies(options.remoteTools?.registry ?? [], kernl.multiplayer.state().families);
 * ```
 */
export function mergeFamilies(host: readonly CvmRegistryFamily[], own: readonly CvmRegistryFamily[]): CvmRegistryFamily[] {
  const key = (family: CvmRegistryFamily): string => `${family.family}:${family.server.pubkey}`;
  const chosen = new Set(own.map(key));
  return [...host.filter((family) => !chosen.has(key(family))), ...own];
}

/**
 * kehto's tool transport over the shell's one pool. A request is published to
 * every relay and succeeds when any accepts it (D-028).
 *
 * @param pool - The shared applesauce pool.
 * @returns The relay surface `createNostrCvmTransport` takes.
 * @example
 * ```ts
 * createNostrCvmTransport({ pool: createCvmRelayPool(pool), defaultRelays });
 * ```
 */
export function createCvmRelayPool(pool: ApplesaucePool): CvmRelayPool {
  return {
    subscribe(relays, filter, params) {
      const handle = subscribeWithEose(pool, relays, [filter as NostrFilter], (item) => {
        if (item === 'EOSE') params.oneose?.();
        else params.onevent?.(item);
      });
      return { close: () => handle.unsubscribe() };
    },
    async publish(relays, event) {
      await publishAccepted(pool, relays, event as NostrEvent);
    },
  };
}

/**
 * The `cvm` service: applets call tools on remote servers through the shell.
 *
 * Each window gets a kehto tool service of its own, with a transport that
 * calls as that window's key (D-041). Two applets that use the same server
 * neither share a client key nor receive each other's server events, and no
 * call is made as the account. When the window ends, its transport closes and
 * its key is wiped.
 *
 * @param options - Pool, default relays, window identities and an optional registry.
 * @returns The service handler to register as `cvm`.
 * @example
 * ```ts
 * registry.cvm = createRemoteToolsService({ pool, relays: () => tiers.get().super, identities });
 * ```
 */
export function createRemoteToolsService(options: RemoteToolsOptions): ServiceHandler {
  const windows = new Map<string, CvmService>();
  let runtime: ServiceRuntimeContext | undefined;
  const serviceFor = (windowId: string): CvmService => {
    let service = windows.get(windowId);
    if (!service) {
      const transport = createNostrCvmTransport({
        pool: createCvmRelayPool(options.pool),
        defaultRelays: [...options.relays()],
        clientSecretKey: options.identities.signer(windowId).key,
      });
      service = createCvmService({ transport, ...(options.registry ? { registry: options.registry() } : {}) });
      if (runtime) service.onRegistered?.(runtime);
      windows.set(windowId, service);
    }
    return service;
  };
  const end = (windowId: string): void => {
    const service = windows.get(windowId);
    windows.delete(windowId);
    service?.onWindowDestroyed?.(windowId);
    service?.dispose();
    options.identities.release(windowId);
  };
  return {
    descriptor: { name: 'cvm', version: '1.0.0', description: 'Remote tools, each window calling under its own key' },
    onRegistered(context) {
      runtime = context;
    },
    onUnregistered() {
      for (const windowId of windows.keys()) end(windowId);
      runtime = undefined;
    },
    handleMessage(windowId, message, send) {
      serviceFor(windowId).handleMessage(windowId, message, send);
    },
    onWindowDestroyed: end,
    onPermissionRevoked: end,
  };
}
