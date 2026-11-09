import { vi } from 'vitest';
import { After } from 'quickpickle';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PrivateKeySigner } from 'applesauce-signers';
import type { NostrEvent } from 'applesauce-core/helpers';
import { createIndexedDbCacheAdapter, createSqliteOpfsCacheAdapter, type CacheRecoveryEvent, type EventCache, type EventCacheAdapter, type LockManagerLike, type SqliteFiles } from '@kernlize/core/cache';
import { connectSqliteWorker } from '../../src/cache/sqlite-worker-client.js';
import { FakeSahPool, poolWorker, type InProcessWorker } from './event-cache-pool.js';
import { MemoryStorage, type CoreWorld } from './world.js';

// The IndexedDB adapter builds key ranges from the global, as it would in a browser.
Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true, writable: true });

/** Everything an event cache scenario keeps. */
export interface CacheState {
  readonly signers: Map<string, PrivateKeySigner>;
  readonly events: Map<string, NostrEvent>;
  readonly adapters: EventCacheAdapter[];
  readonly fallbacks: string[];
  readonly recoveries: CacheRecoveryEvent[];
  readonly storage: MemoryStorage;
  indexedDB: IDBFactory;
  locks: LockManagerLike;
  readonly workers: InProcessWorker[];
  readonly workerStarts: { url: URL; options: WorkerOptions }[];
  readonly open: EventCache[];
  cache?: EventCache;
  pool?: FakeSahPool;
  /** Files to connect to; `worker` means the adapter's own default, a worker started by URL. */
  connect?: (() => Promise<SqliteFiles>) | 'worker';
  filename?: string;
  removed?: number;
  answers?: NostrEvent[][];
  workerAnswer?: unknown;
}

const states = new WeakMap<CoreWorld, CacheState>();
let scenarios = 0;

/**
 * Node's own Web Locks, scoped to one scenario so a cache a scenario leaves open never locks out the next.
 * @param scope - Prefix for every lock name.
 * @returns A lock manager over `navigator.locks`.
 */
const nodeLocks = navigator.locks;

function scopedLocks(scope: string): LockManagerLike {
  return { request: (name, options, callback) => nodeLocks.request(`${scope}:${name}`, options, callback) };
}

export function cacheState(world: CoreWorld): CacheState {
  let state = states.get(world);
  if (!state) {
    scenarios += 1;
    state = {
      signers: new Map(),
      events: new Map(),
      adapters: [],
      fallbacks: [],
      recoveries: [],
      storage: new MemoryStorage(),
      indexedDB: new IDBFactory(),
      locks: scopedLocks(`scenario-${scenarios}`),
      workers: [],
      workerStarts: [],
      open: [],
    };
    states.set(world, state);
  }
  return state;
}

After(async (world: CoreWorld) => {
  const state = states.get(world);
  if (!state) return;
  vi.unstubAllGlobals();
  await Promise.all(state.open.map((cache) => cache.close().catch(() => undefined)));
});

export function signer(state: CacheState, name: string): PrivateKeySigner {
  let found = state.signers.get(name);
  if (!found) state.signers.set(name, (found = new PrivateKeySigner()));
  return found;
}

export async function pubkeyOf(state: CacheState, name: string): Promise<string> {
  return signer(state, name).getPublicKey();
}

/** Sign a named event; the name is in its content, so every named event has its own id. */
export async function named(state: CacheState, name: string, template: { author: string; kind: number; created_at: number; tags?: string[][] }): Promise<NostrEvent> {
  const event = await signer(state, template.author).signEvent({ kind: template.kind, created_at: template.created_at, tags: template.tags ?? [], content: name });
  state.events.set(name, event);
  return event;
}

export function eventNamed(state: CacheState, name: string): NostrEvent {
  const event = state.events.get(name);
  if (!event) throw new Error(`no event named ${name}`);
  return event;
}

/** The names of events, in the order given; unknown events show their id. */
export function namesOf(state: CacheState, events: readonly NostrEvent[]): string[] {
  const byId = new Map([...state.events].map(([name, event]) => [event.id, name]));
  return events.map((event) => byId.get(event.id) ?? event.id);
}

export function currentCache(state: CacheState): EventCache {
  if (!state.cache) throw new Error('no event cache is open');
  return state.cache;
}

export function remember(state: CacheState, cache: EventCache): EventCache {
  state.cache = cache;
  state.open.push(cache);
  return cache;
}

export function poolOf(state: CacheState): FakeSahPool {
  state.pool ??= new FakeSahPool();
  return state.pool;
}

/** Connect to a worker over this scenario's pool, recording the worker. */
export function connectToPool(state: CacheState): Promise<SqliteFiles> {
  const worker = poolWorker(poolOf(state));
  state.workers.push(worker);
  return connectSqliteWorker(worker);
}

export function sqliteAdapter(state: CacheState): EventCacheAdapter {
  const options = { ...(state.filename ? { filename: state.filename } : {}), storage: state.storage, locks: state.locks, onRecover: (event: CacheRecoveryEvent) => state.recoveries.push(event) };
  if (state.connect === 'worker') return createSqliteOpfsCacheAdapter(options);
  return createSqliteOpfsCacheAdapter({ ...options, connect: state.connect ?? (() => connectToPool(state)) });
}

export function indexedDbAdapter(state: CacheState): EventCacheAdapter {
  return createIndexedDbCacheAdapter({ indexedDB: state.indexedDB });
}
