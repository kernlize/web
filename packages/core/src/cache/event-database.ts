import type { IAsyncEventDatabase, IEventDatabase } from 'applesauce-core/event-store';
import { createEventCache } from './event-cache.js';
import type { EventCache } from './types.js';

/**
 * Turn any applesauce event database into a kernl cache: applesauce-sqlite's better-sqlite3, libsql or turso
 * databases, the in-memory `EventMemory`, or a database of your own. kernl's cache rules are applied on top,
 * so the database only has to store rows.
 *
 * @param name - The cache's name.
 * @param database - A synchronous or asynchronous applesauce event database.
 * @param close - Called once when the cache is closed, to release the database.
 * @returns An {@link EventCache} over `database`.
 * @example
 * ```ts
 * import { EventMemory } from 'applesauce-core/event-store';
 * import { fromEventDatabase } from '@kernlize/core/cache';
 *
 * const cache = fromEventDatabase('memory', new EventMemory());
 * await cache.add([]);
 * ```
 */
export function fromEventDatabase(name: string, database: IAsyncEventDatabase | IEventDatabase, close?: () => Promise<void> | void): EventCache {
  return createEventCache(name, {
    put: async (events) => {
      for (const event of events) if (!(await database.hasEvent(event.id))) await database.add(event);
    },
    query: async (filter) => database.getByFilters([filter]),
    remove: async (ids) => {
      for (const id of ids) await database.remove(id);
    },
    clear: async () => {
      await database.removeByFilters([{}]);
    },
    close: async () => {
      await close?.();
    },
  });
}
