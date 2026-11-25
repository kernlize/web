import { getIndexableTags, matchFilter, type Filter, type NostrEvent } from 'applesauce-core/helpers';
import { createEventCache, type EventRecords } from './event-cache.js';
import type { EventCacheAdapter, IndexedDbCacheOptions } from './types.js';

const STORE = 'events';

/** A stored row: the event plus its single-letter tags as `name:value` keys for the multi-entry index. */
type StoredEvent = NostrEvent & { readonly tagKeys: string[] };

/** Resolve when the transaction commits; reject when it aborts, which a failed request also causes. */
function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('unavailable:indexeddb (aborted)', { cause: transaction.error }));
  });
}

function upgrade(db: IDBDatabase): void {
  const store = db.createObjectStore(STORE, { keyPath: 'id' });
  store.createIndex('kind', ['kind', 'created_at']);
  store.createIndex('pubkey', ['pubkey', 'created_at']);
  store.createIndex('created_at', 'created_at');
  store.createIndex('tags', 'tagKeys', { multiEntry: true });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`unavailable:indexeddb (${(request.error as DOMException).name})`));
  });
}

const toRow = (event: NostrEvent): StoredEvent => ({ ...event, tagKeys: [...getIndexableTags(event)] });
const fromRow = ({ tagKeys: _tagKeys, ...event }: StoredEvent): NostrEvent => event;

/** Requests over the narrowest index for a filter: ids, then a tag, then authors, then kinds, then time. */
function candidates(store: IDBObjectStore, filter: Filter): readonly { readonly result: unknown }[] {
  const since = filter.since ?? 0;
  const until = filter.until ?? Infinity;
  const range = (value: string | number): IDBKeyRange => IDBKeyRange.bound([value, since], [value, until]);
  if (filter.ids) return filter.ids.map((id) => store.get(id));
  const tag = Object.keys(filter).find((key) => /^#[a-zA-Z]$/.test(key));
  if (tag) return (filter[tag as `#${string}`] as string[]).map((value) => store.index('tags').getAll(`${tag.slice(1)}:${value}`));
  if (filter.authors) return filter.authors.map((author) => store.index('pubkey').getAll(range(author)));
  if (filter.kinds) return filter.kinds.map((kind) => store.index('kind').getAll(range(kind)));
  return [store.index('created_at').getAll(IDBKeyRange.bound(since, until))];
}

function indexedDbRecords(db: IDBDatabase): EventRecords {
  const write = async (change: (store: IDBObjectStore) => void): Promise<void> => {
    const transaction = db.transaction(STORE, 'readwrite');
    change(transaction.objectStore(STORE));
    await finished(transaction);
  };
  return {
    put: (events) => write((store) => events.forEach((event) => store.put(toRow(event)))),
    query: async (filter) => {
      const transaction = db.transaction(STORE, 'readonly');
      const requests = candidates(transaction.objectStore(STORE), filter);
      await finished(transaction);
      const rows = requests.flatMap((request) => (request.result as StoredEvent | StoredEvent[] | undefined) ?? []);
      return rows.map(fromRow).filter((event) => matchFilter(filter, event));
    },
    remove: (ids) => write((store) => ids.forEach((id) => store.delete(id))),
    clear: () => write((store) => store.clear()),
    close: async () => db.close(),
  };
}

/**
 * An adapter for a cache in IndexedDB: one object store keyed by id, with indexes on kind, author, time and
 * single-letter tags. It needs no worker and no extra library, which makes it the fallback when sqlite over
 * OPFS is unavailable.
 *
 * @param options - The database `name` (default `kernl-events`) and the `indexedDB` factory to use.
 * @returns The `indexeddb` adapter. Its `open` rejects `unavailable:indexeddb` when there is no factory or it refuses.
 * @example
 * ```ts
 * import { createIndexedDbCacheAdapter, openEventCache } from '@kernlize/core/cache';
 *
 * const cache = await openEventCache([createIndexedDbCacheAdapter({ name: 'my-shell-events' })]);
 * ```
 */
export function createIndexedDbCacheAdapter(options: IndexedDbCacheOptions = {}): EventCacheAdapter {
  return {
    name: 'indexeddb',
    open: async () => {
      const factory = options.indexedDB ?? globalThis.indexedDB;
      if (!factory) throw new Error('unavailable:indexeddb');
      return createEventCache('indexeddb', indexedDbRecords(await openDatabase(factory, options.name ?? 'kernl-events')));
    },
  };
}
