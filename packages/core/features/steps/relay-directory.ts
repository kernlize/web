import { expect } from 'vitest';
import { DataTable, Given, Then, When } from 'quickpickle';
import { BehaviorSubject, isObservable, Observable, type Subscriber } from 'rxjs';
import { PrivateKeySigner } from 'applesauce-signers';
import type { Filter, NostrEvent } from 'applesauce-core/helpers';
import { createRelayDirectory, type DirectoryPool, type RelayDirectory, type RelayDirectoryOptions, type RelayListing, type SuggestPurpose } from '@kernlize/core';
import { scratch, splitList, type CoreWorld } from './world.js';

/** A fake pool for monitor servers: it records each subscription and streams what a scenario pushes. */
export interface MonitorPool extends DirectoryPool {
  readonly calls: { relays: string[] | Observable<string[]>; filters: Filter[] }[];
  readonly live: Set<Subscriber<NostrEvent>>;
  readonly relaySets: string[][];
  emit(event: NostrEvent): void;
  fail(): void;
}

export function createMonitorPool(): MonitorPool {
  const pool: MonitorPool = {
    calls: [],
    live: new Set(),
    relaySets: [],
    subscription(relays, filters) {
      pool.calls.push({ relays, filters: filters as Filter[] });
      return new Observable<NostrEvent>((observer) => {
        pool.live.add(observer);
        const watch = isObservable(relays) ? relays.subscribe((list) => pool.relaySets.push(list)) : undefined;
        return () => {
          pool.live.delete(observer);
          watch?.unsubscribe();
        };
      }) as ReturnType<DirectoryPool['subscription']>;
    },
    emit(event) {
      for (const observer of pool.live) observer.next(event);
    },
    fail() {
      for (const observer of pool.live) observer.error(new Error('monitor servers down'));
    },
  };
  return pool;
}

const monitors = new Map<string, PrivateKeySigner>();

function monitor(name: string): PrivateKeySigner {
  const signer = monitors.get(name) ?? new PrivateKeySigner();
  monitors.set(name, signer);
  return signer;
}

/** Sign a kind 30166 report from a named monitor. */
export async function report(name: string, url: string, createdAt: number, tags: string[][] = [], kind = 30166): Promise<NostrEvent> {
  return monitor(name).signEvent({ kind, created_at: createdAt, content: '', tags: [['d', url], ...tags] });
}

interface DirectoryState {
  clock: number;
  pool: MonitorPool;
  directory?: RelayDirectory;
  emissions: (readonly RelayListing[])[];
  monitorRelays$?: BehaviorSubject<readonly string[]>;
}

function state(world: CoreWorld): DirectoryState {
  const value = (scratch(world).directoryState ??= { clock: 1_800_000_000, pool: createMonitorPool(), emissions: [] }) as DirectoryState;
  return value;
}

function directory(world: CoreWorld): RelayDirectory {
  const value = state(world).directory;
  if (!value) throw new Error('create a directory first');
  return value;
}

function create(world: CoreWorld, options: Partial<RelayDirectoryOptions> = {}): void {
  const current = state(world);
  current.emissions = [];
  current.directory = createRelayDirectory({ pool: current.pool, now: () => current.clock, throttleMs: 5, ...options });
  current.directory.listings$.subscribe((listings) => current.emissions.push(listings));
}

function urls(listings: readonly RelayListing[]): string[] {
  return listings.map((listing) => listing.url);
}

function rowTags(row: Record<string, string>): string[][] {
  const tags: string[][] = [];
  if (row['rtt-open']) tags.push(['rtt-open', row['rtt-open']]);
  for (const [column, tag] of [['requirements', 'R'], ['types', 'T'], ['nips', 'N'], ['kinds', 'k']] as const) {
    for (const value of splitList(row[column] ?? '')) tags.push([tag, value]);
  }
  return tags;
}

/** Stream reports so that each server in the table is seen by its count of monitors, all a minute old. */
export async function holdServers(pool: MonitorPool, rows: readonly Record<string, string>[], now: number): Promise<void> {
  for (const row of rows) {
    for (let index = 0; index < Number(row.monitors); index += 1) pool.emit(await report(`monitor-${index}`, row.server as string, now - 60, rowTags(row)));
  }
}

Given('the directory clock reads {int}', (world: CoreWorld, now: number) => {
  state(world).clock = now;
});

Given('a relay directory over the monitor servers {string}', (world: CoreWorld, list: string) => {
  create(world, { relays: splitList(list) });
});

Given('a relay directory over the default monitor servers', (world: CoreWorld) => {
  const current = state(world);
  current.pool = createMonitorPool();
  current.directory = createRelayDirectory({ pool: current.pool });
});

Given('a relay directory with fallback {string}', (world: CoreWorld, list: string) => {
  create(world, { fallback: splitList(list) });
});

Given('a relay directory over a changing list of monitor servers', (world: CoreWorld) => {
  const relays$ = new BehaviorSubject<readonly string[]>(['wss://m1.example']);
  state(world).pool = createMonitorPool();
  state(world).monitorRelays$ = relays$;
  create(world, { relays: relays$ });
});

When('the directory starts', (world: CoreWorld) => {
  directory(world).start();
});

When('the directory stops', (world: CoreWorld) => {
  directory(world).stop();
});

When('monitor {string} reports {string} {int} seconds ago with', async (world: CoreWorld, name: string, url: string, age: number, table: DataTable) => {
  const tags = table.hashes().map((row) => [row.tag as string, row.value as string]);
  state(world).pool.emit(await report(name, url, state(world).clock - age, tags));
});

When('monitor {string} sends a kind 1 note about {string}', async (world: CoreWorld, name: string, url: string) => {
  state(world).pool.emit(await report(name, url, state(world).clock - 60, [], 1));
});

When('monitor {string} sends a report that names no server', async (world: CoreWorld, name: string) => {
  state(world).pool.emit(await monitor(name).signEvent({ kind: 30166, created_at: state(world).clock - 60, content: '', tags: [] }));
});

When('the directory holds these servers', async (world: CoreWorld, table: DataTable) => {
  await holdServers(state(world).pool, table.hashes(), state(world).clock);
});

When('the monitor servers become {string}', (world: CoreWorld, list: string) => {
  state(world).monitorRelays$?.next(splitList(list));
});

When('the monitor servers fail', (world: CoreWorld) => {
  state(world).pool.fail();
});

Then('the directory asked {string} once', (world: CoreWorld, list: string) => {
  const { calls } = state(world).pool;
  expect(calls).toHaveLength(1);
  expect(calls[0]?.relays).toEqual(splitList(list));
});

Then('it asked for kind 30166 on the {string} network since {int}', (world: CoreWorld, network: string, since: number) => {
  expect(state(world).pool.calls[0]?.filters).toEqual([{ kinds: [30166], '#n': [network], since }]);
});

Then('the directory lists {int} server(s)', (world: CoreWorld, count: number) => {
  expect(directory(world).listings()).toHaveLength(count);
});

Then('{string} is listed with', (world: CoreWorld, url: string, table: DataTable) => {
  const found = directory(world).listings().find((entry) => entry.url === url);
  expect(found).toBeDefined();
  const listing: Record<string, unknown> = { ...found };
  for (const { field, value } of table.hashes() as { field: string; value: string }[]) {
    if (field === 'nips') expect(listing[field]).toEqual(splitList(value).map(Number));
    else if (field === 'types') expect(listing[field]).toEqual(splitList(value));
    else if (value === 'true' || value === 'false') expect(listing[field]).toBe(value === 'true');
    else if (field === 'network') expect(listing[field]).toBe(value);
    else expect(listing[field]).toBe(Number(value));
  }
});

Then('the listings stream settles on {int} server(s)', async (world: CoreWorld, count: number) => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  const { emissions } = state(world);
  expect(emissions[0]).toEqual([]);
  expect(emissions.at(-1)).toHaveLength(count);
  expect(emissions.length).toBeLessThanOrEqual(3);
});

Then('searching {string} gives {string}', (world: CoreWorld, text: string, expected: string) => {
  expect(urls(directory(world).search(text))).toEqual(splitList(expected));
});

Then('searching {string} with limit {int} gives {string}', (world: CoreWorld, text: string, limit: number, expected: string) => {
  expect(urls(directory(world).search(text, limit))).toEqual(splitList(expected));
});

Then('the {string} suggestions are {string}', (world: CoreWorld, purpose: SuggestPurpose, expected: string) => {
  expect(urls(directory(world).suggest({ purpose }))).toEqual(splitList(expected));
});

Then('the {string} suggestions limited to {int} are {string}', (world: CoreWorld, purpose: SuggestPurpose, limit: number, expected: string) => {
  expect(urls(directory(world).suggest({ purpose, limit }))).toEqual(splitList(expected));
});

Then('the {string} suggestions without {string} are {string}', (world: CoreWorld, purpose: SuggestPurpose, exclude: string, expected: string) => {
  expect(urls(directory(world).suggest({ purpose, exclude: splitList(exclude) }))).toEqual(splitList(expected));
});

Then(
  'the {string} suggestions without {string} limited to {int} are {string}',
  (world: CoreWorld, purpose: SuggestPurpose, exclude: string, limit: number, expected: string) => {
    expect(urls(directory(world).suggest({ purpose, exclude: splitList(exclude), limit }))).toEqual(splitList(expected));
  },
);

Then('every suggestion has {int} monitors', (world: CoreWorld, count: number) => {
  for (const purpose of ['inbox', 'outbox', 'lookup'] as const) {
    for (const listing of directory(world).suggest({ purpose })) expect(listing.monitors).toBe(count);
  }
});

Then('the directory has no open subscription', (world: CoreWorld) => {
  expect(state(world).pool.live.size).toBe(0);
});

Then('the directory opened {int} subscriptions', (world: CoreWorld, count: number) => {
  expect(state(world).pool.calls).toHaveLength(count);
});

Then("the directory's subscription follows {string}", (world: CoreWorld, list: string) => {
  expect(state(world).pool.relaySets.at(-1)).toEqual(splitList(list));
});
