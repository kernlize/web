import type { BridgeRegistry } from '@kernlize/bridges';
import { createKernlDownloads } from '../kernl-downloads.js';
import type { DownloadClients } from '../downloads/connections.js';
import type { DownloadsOptions } from '../types.js';
import type { KernlModule } from './module.js';

/**
 * Applets working through the download programs the person already runs: the `torrent`, `nzb` and
 * `soulseek` domains, and their connections as `kernl.downloads` (D-050, D-053). Sign-ins are kept
 * by the kernel's secrets provider (D-052). The domains are offered only where kehto's prelude
 * renders their bindings, or where the host says its own does (`offer`); an NZB an applet names by
 * address is fetched through the bridges module, which it requires.
 *
 * @param options - How the page was loaded, the `fetch` for the programs, and whether to offer the domains.
 * @returns The module; its api is the person's `DownloadClients`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [bridgesModule(), downloadsModule()] });
 * kernl.downloads.state$.subscribe(render);
 * ```
 */
export function downloadsModule(options: DownloadsOptions = {}): KernlModule<'downloads', DownloadClients> {
  return {
    id: 'downloads',
    asks: ['download.add'],
    // An NZB an applet names by address is fetched through the web bridge, under its policy (D-050).
    requires: ['bridges'],
    setup(context) {
      const downloads = createKernlDownloads({
        host: context.host,
        ask: (ask) => context.ask(ask),
        options,
        secrets: context.secrets,
        identityOf: (windowId) => context.appletOf(windowId)?.identity,
        ownerOf: (windowId) => context.appletOf(windowId)?.manifest.catalogId,
        async fetchDocument(url, signal) {
          const result = await context.use<BridgeRegistry>('bridges').resolve(url, { requester: 'shell', signal });
          if (result.kind !== 'bytes') throw new Error('unavailable:not-a-document');
          return new Uint8Array(await result.response.arrayBuffer());
        },
      });
      return {
        services: downloads.services,
        ...(downloads.extensions ? { extensions: downloads.extensions } : {}),
        rendersBindings: options.offer === true,
        api: downloads.programs,
        dispose: () => downloads.dispose(),
      };
    },
  };
}
