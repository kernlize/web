import { createMultiplayerSettings } from '../multiplayer/settings.js';
import { discoverToolFamilies } from '../multiplayer/tool-discovery.js';
import { createWindowIdentities } from '../multiplayer/window-identities.js';
import { createDirectConnectionsService } from '../multiplayer/direct-connections.js';
import { createRemoteToolsService, mergeFamilies } from '../multiplayer/remote-tools.js';
import type { KernlMultiplayer, KernlOptions } from '../types.js';
import type { KernlModule } from './module.js';

/** What the host sets for remote tools and direct connections. */
export interface MultiplayerModuleOptions {
  readonly remoteTools?: KernlOptions['remoteTools'];
  readonly directConnections?: KernlOptions['directConnections'];
}

/**
 * Applets reaching other people's software: remote tools, the `cvm` domain, and direct connections,
 * the `webrtc` domain, each window under its own key (D-041, D-042, D-043). The person's own
 * choices of servers and tool families are `kernl.multiplayer`. Direct connections are offered only
 * where the page can make peer connections, and every session is put to the person. Without this
 * module neither domain is offered and the shell never asks about a session.
 *
 * @param options - The host's relays and tool families, and its direct-connection settings.
 * @returns The module; its api is `KernlMultiplayer`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [multiplayerModule({ remoteTools: { relays: ['wss://tools.example'] } })] });
 * kernl.multiplayer.state();
 * ```
 */
export function multiplayerModule(options: MultiplayerModuleOptions = {}): KernlModule<'multiplayer', KernlMultiplayer> {
  return {
    id: 'multiplayer',
    setup(context) {
      const settings = createMultiplayerSettings(context.storage);
      const chosen = () => settings.state();
      const relays = (fallback: readonly string[] | undefined): readonly string[] => chosen().servers ?? fallback ?? context.tiers.get().super;
      const identities = createWindowIdentities();
      const { createPeer, ...direct } = options.directConnections ?? {};
      const canConnect = !!createPeer || typeof RTCPeerConnection === 'function';
      const cvm = createRemoteToolsService({
        pool: context.pool,
        relays: () => relays(options.remoteTools?.relays),
        identities,
        registry: () => mergeFamilies(options.remoteTools?.registry ?? [], chosen().families ?? []),
      });
      const webrtc = canConnect ? createDirectConnectionsService({
        ...(createPeer ? { createPeer } : {}),
        appletOf: (windowId) => context.appletOf(windowId),
        isGranted: (windowId) => context.holds(windowId, 'webrtc'),
        ask: (summary) => context.ask(summary),
        pool: context.pool,
        relays: () => relays(direct.relays),
        identities,
        iceServers: () => chosen().helpers ?? direct.iceServers ?? [],
      }) : undefined;
      return {
        services: { cvm, ...(webrtc ? { webrtc } : {}) },
        api: { ...settings, discover: (input: string) => discoverToolFamilies(input, { pool: context.pool, relays: relays(options.remoteTools?.relays), fetch: globalThis.fetch.bind(globalThis) }) },
      };
    },
  };
}
