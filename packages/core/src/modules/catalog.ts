import type { ConnectedEventCache } from '../cache/connect.js';
import { loadCatalog, streamCatalog, type LoadCatalogOptions } from '../catalog/fetch.js';
import type { AppletCatalog } from '../types.js';
import type { KernlModule } from './module.js';

/**
 * The applet store's catalogue: `kernl.catalog`, the applets published to the `apps` tier, newest
 * first, with what the cache module kept from an earlier visit listed before any relay answers
 * (D-030, D-059). Without it the shell has no store; an applet still opens from its address.
 *
 * @returns The module; its api is the `AppletCatalog`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [catalogModule()] });
 * kernl.catalog.stream().subscribe(render);
 * ```
 */
export function catalogModule(): KernlModule<'catalog', AppletCatalog> {
  return {
    id: 'catalog',
    setup(context) {
      const cached: Pick<LoadCatalogOptions, 'cache' | 'store'> = {
        store: context.eventStore,
        // Read when the store is listed, so the cache module may be loaded after this one, or not at all.
        cache: (filters) => context.find<ConnectedEventCache>('cache')?.cacheRequest(filters) ?? Promise.resolve([]),
      };
      return {
        api: {
          load: (options) => loadCatalog(context.pool, context.tiers, { ...cached, ...options }),
          stream: (options) => streamCatalog(context.pool, context.tiers, { ...cached, ...options }),
        },
      };
    },
  };
}
