import type { BridgeRegistry, TorrentBackend } from '@kernlize/bridges';
import { createDefaultBridges } from '../bridges/default-registry.js';
import type { KernlModule } from '@kernlize/kernel';

/**
 * The bridges: how the shell reaches a locator, from a web address to a magnet link, as
 * `kernl.bridges` (D-010, D-017). The kernel's `resource` service and the person's downloads go
 * through it; without it `resource` is not offered. Every hand-off to an app on the device goes
 * through the host's `openLink`, which asks first.
 *
 * @param options - A registry of the host's own, or the torrent engine for kernl's default one.
 * @returns The module; its api is the `BridgeRegistry`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [bridgesModule({ torrent })] });
 * await kernl.bridges.resolve('magnet:?xt=urn:btih:…', { requester: 'shell' });
 * ```
 */
export function bridgesModule(options: { readonly registry?: BridgeRegistry; readonly torrent?: TorrentBackend } = {}): KernlModule<'bridges', BridgeRegistry> {
  return {
    id: 'bridges',
    setup(context) {
      const registry = options.registry ?? createDefaultBridges({
        handoff: (uri) => context.host.openLink(uri),
        // An applet's own assets sit beside its artifact, on the servers its manifest names (D-055).
        blossomServers(requester) {
          if (requester === 'shell') return [];
          const running = [...context.applets().values()].find(({ summary }) => summary.identity.dTag === requester.dTag && summary.identity.hash === requester.hash);
          return running?.summary.manifest.servers ?? [];
        },
        ...(options.torrent ? { torrent: options.torrent } : {}),
      });
      return { api: registry };
    },
  };
}
