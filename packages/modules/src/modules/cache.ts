import { connectEventCache, type ConnectedEventCache, type EventCacheOpener } from '../cache/connect.js';
import type { KernlModule } from '@kernlize/kernel';

/**
 * The event cache: events kept between visits, asked before any relay by the shell's replaceable
 * loader and the store's catalogue, with new events written back (D-030). Without it, or without
 * an opener, the shell keeps events in memory only.
 *
 * @param open - Opens the cache, such as `() => openEventCache(defaultWebCacheAdapters())` from `@kernlize/modules/cache`.
 * @returns The module; its api is the connected cache, closed when the shell is destroyed.
 * @example
 * ```ts
 * createKernl({ host, modules: [...kernlModules(), cacheModule(() => openEventCache(defaultWebCacheAdapters()))] });
 * ```
 */
export function cacheModule(open?: EventCacheOpener): KernlModule<'cache', ConnectedEventCache> {
  return {
    id: 'cache',
    setup(context) {
      const cache = connectEventCache(context.eventStore, open);
      return { api: cache, dispose: () => cache.close() };
    },
  };
}
