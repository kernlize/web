# Add a cache backend

The event cache has one contract and a backend per context ([D-027](../decisions.md#d-027)). A browser uses sqlite over OPFS, then IndexedDB, then memory. A server, a desktop build or a test harness has better places to keep events: sqlite on disk, postgres, LMDB. This page adds one, first from an applesauce event database, then from rows of your own, and puts it in front of the defaults.

The rules about which event wins are not yours to write. `createEventCache` keeps only the newest replaceable and addressable version, applies kind 5 deletions and skips ephemeral events above every backend, so a backend that stores rows behaves exactly like the built-in ones ([Persistence](../concepts/persistence.md#what-the-cache-keeps)).

## 1. Wrap an applesauce database

Any `IEventDatabase` or `IAsyncEventDatabase` becomes a cache with `fromEventDatabase(name, database, close?)`. applesauce-sqlite has them for better-sqlite3, libsql, turso and node's own sqlite. On a server with better-sqlite3:

<!-- sample:skip needs better-sqlite3 and applesauce-sqlite's better-sqlite3 entry, which kernl does not install -->
```ts
import { BetterSqlite3EventDatabase } from 'applesauce-sqlite/better-sqlite3';
import { fromEventDatabase, type EventCacheAdapter } from '@kernlize/core/cache';

export function createServerCacheAdapter(path: string): EventCacheAdapter {
  return {
    name: 'server-sqlite',
    open: async () => {
      const database = new BetterSqlite3EventDatabase(path);
      return fromEventDatabase('server-sqlite', database, () => database.close());
    },
  };
}
```

`name` is what `EventCache.name` reports and what `onFallback` names. `close` runs once, when the cache is closed. A database written this way uses applesauce-sqlite's schema, which is also the schema of kernl's own sqlite cache, so either can read the other's file.

The same call takes a database of your own. Anything with `hasEvent`, `add`, `remove`, `removeByFilters` and `getByFilters` (and the rest of `IAsyncEventDatabase`) will do; kernl uses only those five. In a test, applesauce's in-memory database is enough:

```ts
import { EventMemory } from 'applesauce-core/event-store';
import type { NostrEvent } from 'applesauce-core/helpers';
import { fromEventDatabase, type EventCacheAdapter } from '@kernlize/core/cache';

export const testCacheAdapter: EventCacheAdapter = {
  name: 'test',
  open: async () => fromEventDatabase('test', new EventMemory<NostrEvent>()),
};
```

## 2. Or store rows yourself

A store that is not an applesauce database, such as postgres through your own client, implements `EventRecords` and hands it to `createEventCache`. It is five methods, and only `query` has to understand filters:

| Member | Must |
| --- | --- |
| `put(events)` | Insert the events, ignoring ids already stored. |
| `query(filter)` | Return only the events matching one filter. Narrow with whatever your store indexes and finish with applesauce's `matchFilter`. Applying `limit` is an optimisation; the layer above sorts and limits again. |
| `remove(ids)` | Delete by id. |
| `clear()`, `close()` | Delete everything; release the connection. |

<!-- sample:continues -->
```ts
import { matchFilter } from 'applesauce-core/helpers';
import { createEventCache, type EventRecords } from '@kernlize/core/cache';

interface Sql {
  run(statement: string, params: readonly unknown[]): Promise<void>;
  rows(statement: string, params: readonly unknown[]): Promise<NostrEvent[]>;
  end(): Promise<void>;
}

declare const sql: Sql;

const postgresRecords: EventRecords = {
  put: async (events) => {
    for (const event of events) await sql.run('INSERT INTO events (id, kind, body) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [event.id, event.kind, event]);
  },
  query: async (filter) => {
    const candidates = filter.kinds ? await sql.rows('SELECT body FROM events WHERE kind = ANY($1)', [filter.kinds]) : await sql.rows('SELECT body FROM events', []);
    return candidates.filter((event) => matchFilter(filter, event));
  },
  remove: async (ids) => sql.run('DELETE FROM events WHERE id = ANY($1)', [ids]),
  clear: async () => sql.run('DELETE FROM events', []),
  close: async () => sql.end(),
};

export const postgresCacheAdapter: EventCacheAdapter = { name: 'postgres', open: async () => createEventCache('postgres', postgresRecords) };
```

The query narrows by kind, the one column this table indexes, and `matchFilter` applies the rest of the filter.

## 3. Refuse a context you cannot serve

`open` decides whether the backend works here. When it cannot, it rejects with an `unavailable:` reason and `openEventCache` moves on to the next adapter; it never throws past `openEventCache`, which falls back to memory.

<!-- sample:continues -->
```ts
export const serverOnlyAdapter: EventCacheAdapter = {
  name: 'server-only',
  open: async () => {
    if (typeof window !== 'undefined') throw new Error('unavailable:browser');
    return testCacheAdapter.open();
  },
};
```

Use the reason to say what is missing (`unavailable:browser`, `unavailable:no-disk`, `unavailable:locked`), since it reaches `onFallback` as written.

## 4. Put it in front of the defaults

<!-- sample:continues -->
```ts
import { defaultWebCacheAdapters, openEventCache } from '@kernlize/core/cache';

const cache = await openEventCache([serverOnlyAdapter, ...defaultWebCacheAdapters()], {
  onFallback: (name, reason) => console.info(`${name} cache skipped: ${reason}`),
});
cache.name; // 'server-only' on a server; 'sqlite-opfs', 'indexeddb' or 'memory' in a browser
```

Then attach it to the event store with `attachEventCache`, as [the package page](../packages/core.md#event-cache) shows.

## Damage and recovery

A backend that can find its storage damaged should never answer from it. kernl's sqlite cache shows the pattern: check on open, and on damage wipe the file, then move to a new filename, then give up with `unavailable:corrupt` ([Persistence](../concepts/persistence.md#when-the-database-is-damaged)). `isCorruptionError` recognises sqlite's damage codes for a backend over another sqlite. A backend over a server database usually has the server's own guarantees, and should reject rather than repair.

## Related

- [Persistence](../concepts/persistence.md#events-kept-between-visits)
- [`@kernlize/core` event cache reference](../packages/core.md#event-cache)
