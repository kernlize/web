import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { from, lastValueFrom, switchMap, toArray } from 'rxjs';
import { EventMemory, EventStore } from 'applesauce-core';
import { isFromCache, type NostrEvent } from 'applesauce-core/helpers';
import { PrivateKeySigner } from 'applesauce-signers';
import { connectEventCache, createMemoryCacheAdapter, fromEventDatabase, createRelayTiers, streamCatalog, type CatalogEntry, type ConnectedEventCache, type EventCache } from '@kernlize/core';
import { boot, k } from './kernl.js';
import { scratch, signManifest, splitList, type CoreWorld } from './world.js';

interface ShellCacheScratch {
  connected?: ConnectedEventCache;
  cache?: EventCache;
  closed: boolean;
  catalogCache?: (filters: unknown[]) => Promise<NostrEvent[]>;
  lists?: (readonly CatalogEntry[])[];
  store?: EventStore;
}

function s(world: CoreWorld): ShellCacheScratch {
  const state = scratch(world);
  state.shellCache ??= { closed: false } satisfies ShellCacheScratch;
  return state.shellCache as ShellCacheScratch;
}

async function trackedMemoryCache(world: CoreWorld, events: NostrEvent[]): Promise<EventCache> {
  const cache = await createMemoryCacheAdapter().open();
  await cache.add(events);
  const close = cache.close.bind(cache);
  const tracked: EventCache = Object.assign(Object.create(cache) as EventCache, {
    close: async () => {
      s(world).closed = true;
      await close();
    },
  });
  s(world).cache = tracked;
  return tracked;
}

async function manifestsFor(specs: string): Promise<NostrEvent[]> {
  const events: NostrEvent[] = [];
  for (const spec of splitList(specs)) {
    const [dTag = '', at = '0'] = spec.split('@');
    events.push((await signManifest({ dTag, title: dTag, createdAt: Number(at) })).event);
  }
  return events;
}

const describe = (entries: readonly CatalogEntry[]): string[] => entries.map((entry) => `${entry.title}@${entry.publishedAt}`);

Given('the shell connects no event cache', (world: CoreWorld) => {
  s(world).connected = connectEventCache(new EventStore());
});

Given('the shell connects an event cache that fails to open', (world: CoreWorld) => {
  s(world).connected = connectEventCache(new EventStore(), () => Promise.reject(new Error('unavailable:locked')));
});

Given('the shell connects a memory event cache holding a profile named {string}', async (world: CoreWorld, name: string) => {
  const profile = await new PrivateKeySigner().signEvent({ kind: 0, tags: [], content: JSON.stringify({ name }), created_at: 1_700_000_000 });
  const cache = await trackedMemoryCache(world, [profile]);
  s(world).connected = connectEventCache(new EventStore(), async () => cache);
});

Then('a cache request for kind 0 returns {int} events', async (world: CoreWorld, count: number) => {
  expect(await s(world).connected?.cacheRequest([{ kinds: [0] }])).toHaveLength(count);
});

Then('a cache request for kind 0 returns {int} events marked as from the cache', async (world: CoreWorld, count: number) => {
  const events = (await s(world).connected?.cacheRequest([{ kinds: [0] }])) ?? [];
  expect(events).toHaveLength(count);
  expect(events.every((event) => isFromCache(event))).toBe(true);
});

Then('closing the connected cache succeeds', async (world: CoreWorld) => {
  await expect(s(world).connected?.close()).resolves.toBeUndefined();
});

Then('closing the connected cache closes it', async (world: CoreWorld) => {
  await s(world).connected?.close();
  expect(s(world).closed).toBe(true);
});

Given('the catalogue cache holds manifests {string}', async (world: CoreWorld, specs: string) => {
  const cached = await manifestsFor(specs);
  // The relay is held until the cache has answered, so "the cache first" does not depend on the machine's speed.
  const pool = scratch(world).pool;
  const relay = pool.request.bind(pool);
  let answered: () => void = () => undefined;
  const cacheAnswered = new Promise<void>((resolve) => (answered = resolve));
  pool.request = ((...args: Parameters<typeof relay>) => from(cacheAnswered).pipe(switchMap(() => relay(...args)))) as typeof pool.request;
  s(world).catalogCache = async () => {
    setTimeout(answered, 0);
    return cached;
  };
});

Given('the catalogue cache fails', (world: CoreWorld) => {
  s(world).catalogCache = () => Promise.reject(new Error('unavailable:corrupt'));
});

When('the catalogue is streamed from the cache and the relays', async (world: CoreWorld) => {
  const cache = s(world).catalogCache as (filters: unknown[]) => Promise<NostrEvent[]>;
  const store = new EventStore();
  s(world).store = store;
  const stream = streamCatalog(scratch(world).pool, createRelayTiers(scratch(world).storage), { cache, store, emitMs: 0 });
  const lists = await lastValueFrom(stream.pipe(toArray()));
  s(world).lists = lists;
  const catalog = (scratch(world).catalog ??= { entries: [] }) as { entries: readonly CatalogEntry[] };
  catalog.entries = lists.at(-1) ?? [];
});

Then('the first streamed list is {string}', (world: CoreWorld, specs: string) => {
  expect(describe(s(world).lists?.[0] ?? [])).toEqual(splitList(specs));
});

Given('a kernl shell whose event cache holds a profile named {string} for a fresh key', async (world: CoreWorld, name: string) => {
  const signer = new PrivateKeySigner();
  scratch(world).freshKey = await signer.getPublicKey();
  const cache = await trackedMemoryCache(world, [await signer.signEvent({ kind: 0, tags: [], content: JSON.stringify({ name }), created_at: 1_700_000_000 })]);
  boot(world, { eventCache: async () => cache });
});

Then("the shell's event cache closes when the shell is destroyed", async (world: CoreWorld) => {
  k(world).kernl.destroy();
  await expect.poll(() => s(world).closed).toBe(true);
});

Then("the store kept the relays' manifest {string}", (world: CoreWorld, dTag: string) => {
  const held = s(world).store?.getByFilters({ kinds: [35129], '#d': [dTag] }) ?? [];
  expect([...held]).toHaveLength(1);
});

Given('a host database of its own holding a profile named {string} for a fresh key', async (world: CoreWorld, name: string) => {
  const signer = new PrivateKeySigner();
  scratch(world).freshKey = await signer.getPublicKey();
  // Any applesauce event database works: this stands in for postgres, LMDB or nostrdb behind the same interface.
  const database = new EventMemory();
  database.add(await signer.signEvent({ kind: 0, tags: [], content: JSON.stringify({ name }), created_at: 1_700_000_000 }));
  scratch(world).hostDatabase = database;
});

Given('a kernl shell whose event cache is that database, wrapped with fromEventDatabase', (world: CoreWorld) => {
  const database = scratch(world).hostDatabase as EventMemory;
  boot(world, { eventCache: async () => fromEventDatabase('host-database', database) });
});
