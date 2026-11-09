import { EventMemory } from 'applesauce-core/event-store';
import type { NostrEvent } from 'applesauce-core/helpers';
import { fromEventDatabase } from './event-database.js';
import { createIndexedDbCacheAdapter } from './indexeddb.js';
import { createSqliteOpfsCacheAdapter } from './sqlite-opfs.js';
import type { EventCache, EventCacheAdapter, OpenEventCacheOptions } from './types.js';

/**
 * An adapter whose cache lives in memory and is gone when the page closes. It always opens, which makes it
 * the last resort of {@link openEventCache}.
 *
 * @returns The `memory` adapter.
 * @example
 * ```ts
 * import { createMemoryCacheAdapter } from '@kernlize/core/cache';
 *
 * const cache = await createMemoryCacheAdapter().open();
 * cache.name; // 'memory'
 * ```
 */
export function createMemoryCacheAdapter(): EventCacheAdapter {
  return { name: 'memory', open: async () => fromEventDatabase('memory', new EventMemory<NostrEvent>()) };
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Open the first adapter that can open in this context. An adapter that rejects is reported through
 * `onFallback` and the next one is tried; when none opens, the cache is kept in memory. It never rejects:
 * the cache is an accelerator, and the shell runs without one (D-027).
 *
 * @param adapters - Adapters in order of preference.
 * @param options - `onFallback`, told the name and reason of every adapter that did not open.
 * @returns The opened cache.
 * @example
 * ```ts
 * import { defaultWebCacheAdapters, openEventCache } from '@kernlize/core/cache';
 *
 * const cache = await openEventCache(defaultWebCacheAdapters(), {
 *   onFallback: (name, reason) => console.info(`${name} cache skipped: ${reason}`),
 * });
 * ```
 */
export async function openEventCache(adapters: readonly EventCacheAdapter[], options: OpenEventCacheOptions = {}): Promise<EventCache> {
  for (const adapter of adapters) {
    try {
      return await adapter.open();
    } catch (error) {
      options.onFallback?.(adapter.name, reasonOf(error));
    }
  }
  return createMemoryCacheAdapter().open();
}

/**
 * The adapters a browser shell tries, in order: sqlite over OPFS in a worker, then IndexedDB, then memory.
 *
 * @returns `[sqlite-opfs, indexeddb, memory]` with their default options.
 * @example
 * ```ts
 * import { defaultWebCacheAdapters, openEventCache } from '@kernlize/core/cache';
 *
 * const cache = await openEventCache(defaultWebCacheAdapters());
 * ```
 */
export function defaultWebCacheAdapters(): readonly EventCacheAdapter[] {
  return [createSqliteOpfsCacheAdapter(), createIndexedDbCacheAdapter(), createMemoryCacheAdapter()];
}
