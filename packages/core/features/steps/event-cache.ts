import { expect, vi } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import { IDBFactory } from 'fake-indexeddb';
import { EventStore } from 'applesauce-core';
import { EventMemory, type IAsyncEventDatabase } from 'applesauce-core/event-store';
import { isFromCache, type Filter, type NostrEvent } from 'applesauce-core/helpers';
import type { CacheRequest } from 'applesauce-loaders';
import {
  attachEventCache,
  createMemoryCacheAdapter,
  defaultWebCacheAdapters,
  fromEventDatabase,
  openEventCache,
  type AttachedEventCache,
  type EventCache,
} from '@kernlize/core/cache';
import { cacheState, currentCache, eventNamed, indexedDbAdapter, named, namesOf, pubkeyOf, remember, sqliteAdapter, type CacheState } from './event-cache-world.js';
import { splitList, type CoreWorld } from './world.js';

interface AttachState {
  store: EventStore;
  attached: AttachedEventCache;
  writes: NostrEvent[][];
  answered: NostrEvent[];
  released: boolean;
}

const attachments = new WeakMap<CacheState, AttachState>();

function attachment(state: CacheState): AttachState {
  const found = attachments.get(state);
  if (!found) throw new Error('no event store is attached');
  return found;
}

const list = (names: string): string[] => (names.trim() === '' ? [] : splitList(names));

async function openFor(state: CacheState, backend: string): Promise<EventCache> {
  if (backend === 'memory') return createMemoryCacheAdapter().open();
  if (backend === 'indexeddb') return indexedDbAdapter(state).open();
  return sqliteAdapter(state).open();
}

async function openWith(world: CoreWorld, adapters: Parameters<typeof openEventCache>[0]): Promise<void> {
  const state = cacheState(world);
  remember(state, await openEventCache(adapters, { onFallback: (name, reason) => state.fallbacks.push(`${name}: ${reason}`) }));
}

Given('a cache adapter {string} that rejects with {string}', (world: CoreWorld, name: string, reason: string) => {
  cacheState(world).adapters.push({ name, open: () => Promise.reject(new Error(reason)) });
});

Given('a cache adapter {string} that rejects with the bare value {string}', (world: CoreWorld, name: string, reason: string) => {
  // A custom adapter may reject with something that is not an Error; the fallback still reports it.
  cacheState(world).adapters.push({ name, open: () => Promise.reject(reason) });
});

Given('a working cache adapter {string}', (world: CoreWorld, name: string) => {
  cacheState(world).adapters.push({ name, open: async () => fromEventDatabase(name, new EventMemory<NostrEvent>()) });
});

Given('the page has IndexedDB', () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

Given('an IndexedDB database {string} from a newer version of the shell', async (world: CoreWorld, name: string) => {
  const request = cacheState(world).indexedDB.open(name, 5);
  await new Promise((resolve) => (request.onsuccess = resolve));
  request.result.close();
});

Given('an open {string} event cache', async (world: CoreWorld, backend: string) => {
  const state = cacheState(world);
  remember(state, await openFor(state, backend));
});

When('the shell opens the event cache', (world: CoreWorld) => openWith(world, cacheState(world).adapters));
When('the shell opens the event cache with the web defaults', (world: CoreWorld) => openWith(world, defaultWebCacheAdapters()));
When('the shell opens the event cache with IndexedDB', (world: CoreWorld) => openWith(world, [indexedDbAdapter(cacheState(world))]));
When('the shell opens the event cache with sqlite then IndexedDB', (world: CoreWorld) => {
  const state = cacheState(world);
  return openWith(world, [sqliteAdapter(state), indexedDbAdapter(state)]);
});

Then('the event cache is {string}', (world: CoreWorld, name: string) => {
  expect(currentCache(cacheState(world)).name).toBe(name);
});

Then('the fallbacks reported are {string}', (world: CoreWorld, reported: string) => {
  expect(cacheState(world).fallbacks).toEqual(reported.split(', '));
});

Then('the fallback reason for {string} starts with {string}', (world: CoreWorld, name: string, prefix: string) => {
  const reported = cacheState(world).fallbacks.find((line) => line.startsWith(`${name}: `));
  expect(reported?.slice(name.length + 2)).toMatch(new RegExp(`^${prefix}`));
});

Then('the default web cache adapters are {string}', (_world: CoreWorld, names: string) => {
  expect(defaultWebCacheAdapters().map((adapter) => adapter.name)).toEqual(splitList(names));
});

async function store(world: CoreWorld, name: string, template: { author: string; kind: number; created_at: number; tags?: string[][] }): Promise<void> {
  const state = cacheState(world);
  await currentCache(state).add([await named(state, name, template)]);
}

const dTag = (identifier: string): string[][] => [['d', identifier]];

When('the cache stores a kind {int} event {string} by {string} at {int}', (world: CoreWorld, kind: number, name: string, author: string, at: number) =>
  store(world, name, { author, kind, created_at: at }),
);

When('the cache stores a kind {int} event {string} by {string} with d {string} at {int}', (world: CoreWorld, kind: number, name: string, author: string, d: string, at: number) =>
  store(world, name, { author, kind, created_at: at, tags: dTag(d) }),
);

When('the cache stores a kind {int} event {string} by {string} with no d at {int}', (world: CoreWorld, kind: number, name: string, author: string, at: number) =>
  store(world, name, { author, kind, created_at: at }),
);

When('the cache stores in one batch a kind {int} event {string} by {string} at {int} and {string} at {int} and {string} at {int}', async (world: CoreWorld, kind: number, a: string, author: string, atA: number, b: string, atB: number, c: string, atC: number) => {
  const state = cacheState(world);
  const batch = [await named(state, a, { author, kind, created_at: atA }), await named(state, b, { author, kind, created_at: atB }), await named(state, c, { author, kind, created_at: atC })];
  await currentCache(state).add([...batch, batch[0] as NostrEvent]);
});

When('the cache stores {string} again', async (world: CoreWorld, name: string) => {
  const state = cacheState(world);
  await currentCache(state).add([eventNamed(state, name)]);
});

When('{string} deletes {string} at {int}', async (world: CoreWorld, author: string, target: string, at: number) => {
  const state = cacheState(world);
  await currentCache(state).add([await named(state, `delete ${target} by ${author}`, { author, kind: 5, created_at: at, tags: [['e', eventNamed(state, target).id]] })]);
});

When('{string} deletes the addresses of {string} at {int}', async (world: CoreWorld, author: string, targets: string, at: number) => {
  const state = cacheState(world);
  const pubkey = await pubkeyOf(state, author);
  const tags = splitList(targets).map((name) => {
    const event = eventNamed(state, name);
    return ['a', `${event.kind}:${pubkey}:${event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''}`];
  });
  await currentCache(state).add([await named(state, `delete addresses by ${author}`, { author, kind: 5, created_at: at, tags })]);
});

Given('the cache holds these events:', async (world: CoreWorld, table: DataTable) => {
  const state = cacheState(world);
  const events: NostrEvent[] = [];
  for (const row of table.hashes()) {
    const tags = row.tags ? [row.tags.split('=').map((part, at) => (at === 1 && state.events.has(part) ? eventNamed(state, part).id : part))] : [];
    events.push(await named(state, row.name as string, { author: row.author as string, kind: Number(row.kind), created_at: Number(row.created_at), tags }));
  }
  await currentCache(state).add(events);
});

/** A filter written with event and author names, resolved to ids and pubkeys. */
async function resolveFilter(state: CacheState, written: string): Promise<Filter> {
  const filter = JSON.parse(written) as Record<string, unknown>;
  const ids = (names: string[]) => names.map((name) => state.events.get(name)?.id ?? name);
  if (Array.isArray(filter.ids)) filter.ids = ids(filter.ids as string[]);
  if (Array.isArray(filter['#e'])) filter['#e'] = ids(filter['#e'] as string[]);
  if (Array.isArray(filter.authors)) filter.authors = await Promise.all((filter.authors as string[]).map((name) => pubkeyOf(state, name)));
  return filter as Filter;
}

async function queried(state: CacheState, filters: Filter[]): Promise<string[]> {
  return namesOf(state, await currentCache(state).query(filters));
}

/** Names in the order a cache must answer them: newest first, the lower id first on a tie (NIP-01). */
function inAnswerOrder(state: CacheState, names: string[]): string[] {
  const events = names.map((name) => eventNamed(state, name));
  return namesOf(state, events.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)));
}

Then('these filters return:', async (world: CoreWorld, table: DataTable) => {
  const state = cacheState(world);
  for (const row of table.hashes()) {
    expect(await queried(state, [await resolveFilter(state, row.filter as string)]), row.filter).toEqual(inAnswerOrder(state, list(row.events as string)));
  }
});

Then('the filters {} and {} together return {string}', async (world: CoreWorld, a: string, b: string, names: string) => {
  const state = cacheState(world);
  expect(await queried(state, [await resolveFilter(state, a), await resolveFilter(state, b)])).toEqual(list(names));
});

Then('a query for kind {int} by {string} returns {string}', async (world: CoreWorld, kind: number, author: string, names: string) => {
  const state = cacheState(world);
  expect(await queried(state, [{ kinds: [kind], authors: [await pubkeyOf(state, author)] }])).toEqual(list(names));
});

Then('a query for kind {int} by {string} returns whichever of {string} has the lower id', async (world: CoreWorld, kind: number, author: string, names: string) => {
  const state = cacheState(world);
  const [lowest] = splitList(names).sort((a, b) => (eventNamed(state, a).id < eventNamed(state, b).id ? -1 : 1));
  expect(await queried(state, [{ kinds: [kind], authors: [await pubkeyOf(state, author)] }])).toEqual([lowest]);
});

Then('storing an event fails with {string}', async (world: CoreWorld, reason: string) => {
  const state = cacheState(world);
  const event = await named(state, 'refused', { author: 'alice', kind: 1, created_at: 1000 });
  await expect(currentCache(state).add([event])).rejects.toThrow(reason);
});

/** A factory whose connections abort every write, as a browser does when the origin is out of quota. */
function abortingWrites(factory: IDBFactory): IDBFactory {
  return new Proxy(factory, {
    get(target, key) {
      if (key !== 'open') return Reflect.get(target, key);
      return (name: string, version?: number) => {
        const request = target.open(name, version);
        request.addEventListener('success', () => {
          const db = request.result;
          const transaction = db.transaction.bind(db);
          db.transaction = ((stores: string, mode?: IDBTransactionMode) => {
            const opened = transaction(stores, mode);
            if (mode === 'readwrite') queueMicrotask(() => opened.abort());
            return opened;
          }) as IDBDatabase['transaction'];
        });
        return request;
      };
    },
  });
}

Given("the page's IndexedDB aborts every write", (world: CoreWorld) => {
  const state = cacheState(world);
  state.indexedDB = abortingWrites(state.indexedDB);
});

Then('a query for kind {int} by {string} returns nothing', async (world: CoreWorld, kind: number, author: string) => {
  const state = cacheState(world);
  expect(await queried(state, [{ kinds: [kind], authors: [await pubkeyOf(state, author)] }])).toEqual([]);
});

Then('a query for every event returns {string}', async (world: CoreWorld, names: string) => {
  expect(await queried(cacheState(world), [{}])).toEqual(list(names));
});

Then('a query for every event returns nothing', async (world: CoreWorld) => {
  expect(await queried(cacheState(world), [{}])).toEqual([]);
});

Then('a query for every event fails with {string}', async (world: CoreWorld, reason: string) => {
  await expect(currentCache(cacheState(world)).query([{}])).rejects.toThrow(reason);
});

When('the cache removes the events matching {}', async (world: CoreWorld, written: string) => {
  const state = cacheState(world);
  state.removed = await currentCache(state).removeByFilters([await resolveFilter(state, written)]);
});

Then('{int} events were removed', (world: CoreWorld, count: number) => {
  expect(cacheState(world).removed).toBe(count);
});

When('the cache is cleared', (world: CoreWorld) => currentCache(cacheState(world)).clear());
When('the cache is closed', (world: CoreWorld) => currentCache(cacheState(world)).close());

function attach(world: CoreWorld, cache: EventCache): void {
  const state = cacheState(world);
  const store = new EventStore();
  const writes: NostrEvent[][] = [];
  const counted: EventCache = { ...cache, add: (events) => (writes.push([...events]), cache.add(events)) };
  attachments.set(state, { store, writes, answered: [], released: false, attached: attachEventCache(store, counted, { batchTime: 5 }) });
  remember(state, cache);
}

Given('an open {string} event cache attached to an event store', async (world: CoreWorld, backend: string) => {
  attach(world, await openFor(cacheState(world), backend));
});

Given('an event cache whose reads fail attached to an event store', async (world: CoreWorld) => {
  const cache = await createMemoryCacheAdapter().open();
  attach(world, { ...cache, query: () => Promise.reject(new Error('unavailable:gone')) });
});

When('the event store receives a kind {int} event {string} by {string} at {int}', async (world: CoreWorld, kind: number, name: string, author: string, at: number) => {
  const state = cacheState(world);
  attachment(state).store.add(await named(state, name, { author, kind, created_at: at }));
});

When('the next batch is written', async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
});

When('a loader asks the cache for kind {int} by {string}', async (world: CoreWorld, kind: number, author: string) => {
  const state = cacheState(world);
  const request: CacheRequest = attachment(state).attached.cacheRequest;
  attachment(state).answered = (await request([{ kinds: [kind], authors: [await pubkeyOf(state, author)] }])) as NostrEvent[];
});

Then('the loader is answered {string} marked as from the cache', (world: CoreWorld, names: string) => {
  const state = cacheState(world);
  const { answered } = attachment(state);
  expect(namesOf(state, answered)).toEqual(list(names));
  expect(answered.every(isFromCache)).toBe(true);
});

Then('the loader is answered nothing', (world: CoreWorld) => {
  expect(attachment(cacheState(world)).answered).toEqual([]);
});

When('the event store receives the events the loader was answered', (world: CoreWorld) => {
  const { store, answered } = attachment(cacheState(world));
  for (const event of answered) store.add(event);
});

Then('the cache was not written again', (world: CoreWorld) => {
  const { writes, attached } = attachment(cacheState(world));
  expect(writes).toEqual([]);
  attached.stop();
});

/** An applesauce database that answers through promises, as a server-side one would. */
function asyncDatabase(memory: EventMemory<NostrEvent>): IAsyncEventDatabase {
  return {
    hasEvent: async (id) => memory.hasEvent(id),
    getEvent: async (id) => memory.getEvent(id),
    hasReplaceable: async (kind, pubkey, identifier) => memory.hasReplaceable(kind, pubkey, identifier),
    getReplaceable: async (kind, pubkey, identifier) => memory.getReplaceable(kind, pubkey, identifier),
    getReplaceableHistory: async (kind, pubkey, identifier) => memory.getReplaceableHistory(kind, pubkey, identifier),
    getByFilters: async (filters) => memory.getByFilters(filters),
    getTimeline: async (filters) => memory.getTimeline(filters),
    add: async (event) => memory.add(event),
    remove: async (event) => memory.remove(event),
    removeByFilters: async (filters) => memory.removeByFilters(filters),
  };
}

Given('an asynchronous applesauce event database wrapped as the {string} cache', (world: CoreWorld, name: string) => {
  const state = cacheState(world);
  const record = { released: false } as AttachState;
  attachments.set(state, record);
  remember(state, fromEventDatabase(name, asyncDatabase(new EventMemory<NostrEvent>()), () => void (record.released = true)));
});

Then('the database was released', (world: CoreWorld) => {
  expect(attachment(cacheState(world)).released).toBe(true);
});
