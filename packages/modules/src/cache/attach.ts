import { EMPTY } from 'rxjs';
import type { IEventStoreStreams } from 'applesauce-core/event-store';
import { persistEventsToCache } from 'applesauce-core/helpers/event-cache';
import { markFromCache, type Filter, type NostrEvent } from 'applesauce-core/helpers';
import type { AttachedEventCache, AttachEventCacheOptions, EventCache } from './types.js';

/**
 * Wire a cache to an event store. New events the store receives are written in batches through applesauce's
 * `persistEventsToCache`, which skips events that came from the cache. `cacheRequest` is what applesauce
 * loaders take as their `cacheRequest`: it marks every event it returns as from the cache, and resolves
 * nothing when the cache cannot answer, because a cache is an accelerator, never identity.
 *
 * @param store - An event store, or anything with its `insert$` stream.
 * @param cache - The cache to write to and read from.
 * @param options - `batchTime` and `maxBatchSize` for the writes.
 * @returns `cacheRequest` and `stop`, which ends the writes.
 * @example
 * ```ts
 * import { EventStore } from 'applesauce-core';
 * import { attachEventCache, createMemoryCacheAdapter } from '@kernlize/core/cache';
 *
 * const store = new EventStore();
 * const attached = attachEventCache(store, await createMemoryCacheAdapter().open());
 * await attached.cacheRequest([{ kinds: [0], limit: 1 }]);
 * attached.stop();
 * ```
 */
export function attachEventCache(store: Pick<IEventStoreStreams, 'insert$'>, cache: EventCache, options: AttachEventCacheOptions = {}): AttachedEventCache {
  const stop = persistEventsToCache({ insert$: store.insert$, update$: EMPTY, remove$: EMPTY }, (events) => cache.add(events), options);
  return {
    cacheRequest: async (filters: Filter[]): Promise<NostrEvent[]> => {
      try {
        const events = await cache.query(filters);
        for (const event of events) markFromCache(event);
        return events;
      } catch {
        return [];
      }
    },
    stop,
  };
}
