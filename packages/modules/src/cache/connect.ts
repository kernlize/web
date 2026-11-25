import type { IEventStoreStreams } from 'applesauce-core';
import type { Filter, NostrEvent } from 'applesauce-core/helpers';
import { attachEventCache } from './attach.js';
import type { EventCache } from './types.js';

/** An event cache the shell opens itself, once, on start. */
export type EventCacheOpener = () => Promise<EventCache | undefined>;

/** The shell's side of its event cache: what loaders ask, and how it is let go. */
export interface ConnectedEventCache {
  /** Loader `cacheRequest`: cached matches marked as from the cache; none while the cache opens or when there is none. */
  readonly cacheRequest: (filters: Filter[]) => Promise<NostrEvent[]>;
  /** Stop writing, then close the cache. */
  close(): Promise<void>;
}

/**
 * Open the shell's event cache in the background and attach it to the store.
 *
 * The shell starts at once: a request that comes before the cache is open
 * waits for it, and a cache that fails to open leaves the shell without one,
 * because the cache is an accelerator (D-030).
 *
 * @param store - The shell's event store; its new events are written to the cache.
 * @param open - Opens the cache, such as `() => openEventCache(defaultWebCacheAdapters())`; none when absent.
 * @returns The loader hook and the release.
 * @example
 * ```ts
 * const cache = connectEventCache(eventStore, () => openEventCache(defaultWebCacheAdapters()));
 * createAddressLoader(pool, { cacheRequest: cache.cacheRequest });
 * ```
 */
export function connectEventCache(store: Pick<IEventStoreStreams, 'insert$'>, open?: EventCacheOpener): ConnectedEventCache {
  const opening = open ? open().catch(() => undefined) : Promise.resolve(undefined);
  const attached = opening.then((cache) => (cache ? { cache, link: attachEventCache(store, cache) } : undefined));
  return {
    cacheRequest: async (filters) => {
      const ready = await attached;
      return ready ? ready.link.cacheRequest(filters) : [];
    },
    async close() {
      const ready = await attached;
      ready?.link.stop();
      await ready?.cache.close();
    },
  };
}
