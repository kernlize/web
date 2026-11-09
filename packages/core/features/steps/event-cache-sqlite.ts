import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { isCorruptionError, openEventCache, type SqliteFiles } from '@kernlize/core/cache';
import { attachSqliteWorker } from '../../src/cache/sqlite-worker-handler.js';
import type { WorkerResponse } from '../../src/cache/sqlite-worker-client.js';
import { InProcessWorker, inconsistentDatabase, malformedDatabase, NOT_A_DATABASE, poolWorker, sqliteOver } from './event-cache-pool.js';
import { cacheState, connectToPool, currentCache, indexedDbAdapter, poolOf, pubkeyOf, remember, sqliteAdapter, type CacheState } from './event-cache-world.js';
import { splitList, type CoreWorld } from './world.js';

const DEFAULT_FILE = '/kernl-events.sqlite3';

Given('a sqlite pool', (world: CoreWorld) => {
  poolOf(cacheState(world));
});

Given('a sqlite pool whose database file is not a database', (world: CoreWorld) => {
  poolOf(cacheState(world)).files.set(DEFAULT_FILE, NOT_A_DATABASE);
});

Given('a sqlite pool whose {string} file is not a database', (world: CoreWorld, filename: string) => {
  poolOf(cacheState(world)).files.set(filename, NOT_A_DATABASE);
});

When('the shell opens the event cache with sqlite at {string} then IndexedDB', async (world: CoreWorld, filename: string) => {
  const state = cacheState(world);
  state.filename = filename;
  remember(state, await openEventCache([sqliteAdapter(state), indexedDbAdapter(state)]));
});

Given('a sqlite pool whose database file is malformed', (world: CoreWorld) => {
  poolOf(cacheState(world)).files.set(DEFAULT_FILE, malformedDatabase());
});

Given('a sqlite pool whose database file is inconsistent', (world: CoreWorld) => {
  poolOf(cacheState(world)).files.set(DEFAULT_FILE, inconsistentDatabase());
});

Given('a sqlite pool where every database file is not a database', (world: CoreWorld) => {
  poolOf(cacheState(world)).everyFileDamaged = true;
});

When('every new database file is not a database', (world: CoreWorld) => {
  poolOf(cacheState(world)).everyFileDamaged = true;
});

Given('the sqlite pool cannot remove files', (world: CoreWorld) => {
  poolOf(cacheState(world)).unlinkFails = true;
});

Given('a sqlite pool that cannot open files', (world: CoreWorld) => {
  poolOf(cacheState(world)).openFails = 'disk full';
});

Given('another tab holds the event cache', async (world: CoreWorld) => {
  const state = cacheState(world);
  await new Promise<void>((held) => {
    void state.locks.request(`kernl:event-cache:${DEFAULT_FILE}`, { ifAvailable: true }, () => {
      held();
      return new Promise<void>(() => undefined);
    });
  });
});

Given('a lock manager that refuses every request', (world: CoreWorld) => {
  // A lock manager of the host's own may reject with a bare value rather than an Error.
  cacheState(world).locks = { request: () => Promise.reject('locks refused') };
});

When('the shell opens the sqlite cache again', async (world: CoreWorld) => {
  const state = cacheState(world);
  remember(state, await sqliteAdapter(state).open());
});

Then('the cache reported no recovery', (world: CoreWorld) => {
  expect(cacheState(world).recoveries).toEqual([]);
});

Then('the cache reported recovery {string} because {string}', (world: CoreWorld, action: string, reason: string) => {
  const { recoveries } = cacheState(world);
  expect(recoveries.map((event) => event.action)).toEqual([action]);
  expect(recoveries[0]?.reason).toContain(reason);
});

Then('the cache reported recoveries {string}', (world: CoreWorld, actions: string) => {
  expect(cacheState(world).recoveries.map((event) => event.action)).toEqual(splitList(actions));
});

Then("the cache's filename is now {string}", (world: CoreWorld, filename: string) => {
  expect(cacheState(world).storage.getItem('kernl:event-cache:v1')).toBe(filename);
});

function openFile(state: CacheState) {
  const file = [...poolOf(state).open.values()].at(-1);
  if (!file) throw new Error('no database file is open');
  return file;
}

When('the open database becomes damaged', (world: CoreWorld) => {
  openFile(cacheState(world)).damage();
});

When('the open database fails to close once', (world: CoreWorld) => {
  openFile(cacheState(world)).failCloseOnce = true;
});

When('the open database is busy', (world: CoreWorld) => {
  openFile(cacheState(world)).busy = true;
});

When('two queries for kind {int} by {string} run at once', async (world: CoreWorld, kind: number, author: string) => {
  const state = cacheState(world);
  const filter = { kinds: [kind], authors: [await pubkeyOf(state, author)] };
  state.answers = await Promise.all([currentCache(state).query([filter]), currentCache(state).query([filter])]);
});

Then('both queries answered nothing', (world: CoreWorld) => {
  expect(cacheState(world).answers).toEqual([[], []]);
});

Then('clearing the cache fails with {string}', async (world: CoreWorld, reason: string) => {
  await expect(currentCache(cacheState(world)).clear()).rejects.toThrow(reason);
});

Then('the cache can still be closed', async (world: CoreWorld) => {
  await expect(currentCache(cacheState(world)).close()).resolves.toBeUndefined();
});

Then('the error {string} is damage: {word}', (_world: CoreWorld, message: string, damage: string) => {
  expect(isCorruptionError(new Error(message))).toBe(damage === 'yes');
  expect(isCorruptionError(message)).toBe(damage === 'yes');
});

async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Files whose second and later failed queries come back only after a repair has finished. */
async function lateFiles(state: CacheState): Promise<SqliteFiles> {
  const files = await connectToPool(state);
  let failures = 0;
  return {
    ...files,
    open: async (filename) => {
      const driver = await files.open(filename);
      return {
        ...driver,
        query: async (statement) => {
          try {
            return await driver.query(statement);
          } catch (error) {
            failures += 1;
            if (failures > 1) await until(() => state.recoveries.length > 0);
            throw error;
          }
        },
      };
    },
  };
}

Given('an open {string} event cache whose damaged queries answer late', async (world: CoreWorld, _backend: string) => {
  const state = cacheState(world);
  state.connect = () => lateFiles(state);
  remember(state, await sqliteAdapter(state).open());
});

function stubBrowser(state: CacheState, start: (worker: InProcessWorker) => void, ready?: Promise<unknown>): void {
  class StubWorker extends InProcessWorker {
    constructor(url: URL, options: WorkerOptions) {
      super(ready);
      state.workerStarts.push({ url, options });
      state.workers.push(this);
      start(this);
    }
  }
  state.connect = 'worker';
  vi.stubGlobal('Worker', StubWorker);
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({}) } });
}

Given('the page has workers and OPFS backed by a sqlite pool', (world: CoreWorld) => {
  const state = cacheState(world);
  const pool = poolOf(state);
  stubBrowser(state, (worker) => attachSqliteWorker(worker.scope, async () => sqliteOver(pool)));
});

Given('the sqlite worker crashes on start', (world: CoreWorld) => {
  const state = cacheState(world);
  const pool = poolOf(state);
  stubBrowser(state, (worker) => {
    worker.crashOnStart = true;
    attachSqliteWorker(worker.scope, async () => sqliteOver(pool));
  });
});

Given('the page has workers and OPFS running the real sqlite worker entry', (world: CoreWorld) => {
  const state = cacheState(world);
  let current: InProcessWorker | undefined;
  // The entry registers on its global scope; here that scope is the stub worker the adapter starts.
  vi.stubGlobal('addEventListener', (type: 'message', listener: (event: { data: unknown }) => void) => current?.scope.addEventListener(type, listener));
  vi.stubGlobal('postMessage', (message: unknown) => current?.scope.postMessage(message));
  let entry: Promise<unknown> | undefined;
  const ready = new Promise((resolve) => setTimeout(() => resolve(entry), 0));
  stubBrowser(
    state,
    (worker) => {
      current = worker;
      entry = import('../../src/cache/sqlite-worker.js');
    },
    ready,
  );
});

Then('the sqlite worker was started as a module from {string}', (world: CoreWorld, file: string) => {
  const [start] = cacheState(world).workerStarts;
  expect(start?.url.href.endsWith(`/${file}`)).toBe(true);
  expect(start?.options.type).toBe('module');
});

Then('the sqlite worker was stopped', (world: CoreWorld) => {
  expect(cacheState(world).workers.at(-1)?.terminated).toBe(true);
});

Given('a sqlite worker backed by a sqlite pool', (world: CoreWorld) => {
  const state = cacheState(world);
  state.workers.push(poolWorker(poolOf(state)));
});

When('the main thread queries {string} in the worker', async (world: CoreWorld, filename: string) => {
  const state = cacheState(world);
  const worker = state.workers.at(-1) as InProcessWorker;
  const answer = new Promise<WorkerResponse>((resolve) => worker.addEventListener('message', ({ data }) => resolve(data as WorkerResponse)));
  worker.postMessage({ id: 1, op: 'query', filename, statement: { sql: 'SELECT 1' } });
  state.workerAnswer = await answer;
});

Then('the worker answers {string}', (world: CoreWorld, error: string) => {
  expect(cacheState(world).workerAnswer).toEqual({ id: 1, ok: false, error });
});
