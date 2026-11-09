import { createEventCache } from './event-cache.js';
import { checkAndMigrate, isCorruptionError, sqliteRecords } from './sqlite-records.js';
import { connectSqliteWorker, type WorkerLike } from './sqlite-worker-client.js';
import type { CacheRecoveryEvent, EventCacheAdapter, FilenameStorage, LockManagerLike, SqliteDriver, SqliteFiles, SqliteOpfsOptions } from './types.js';

const DEFAULT_FILENAME = '/kernl-events.sqlite3';
const FILENAME_KEY = 'kernl:event-cache:v1';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const closeQuietly = (driver: SqliteDriver): Promise<void> => driver.close().catch(() => undefined);
const unavailable = (reason: string): Error => new Error(reason.startsWith('unavailable:') ? reason : `unavailable:${reason}`);

/** Hold the named lock until the returned release is called; null when another tab holds it. */
function acquire(locks: LockManagerLike, name: string): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) return resolve(null);
        return new Promise<void>((release) => resolve(release));
      })
      .catch((error: unknown) => reject(unavailable(messageOf(error))));
  });
}

/** The file after `filename` in the rotation: `/a.sqlite3` → `/a-1.sqlite3` → `/a-2.sqlite3`. */
export function nextFilename(base: string, filename: string): string {
  const dot = base.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
  const current = filename === base ? 0 : Number(filename.slice(stem.length + 1, filename.length - extension.length));
  return `${stem}-${current + 1}${extension}`;
}

function spawnWorker(): Promise<SqliteFiles> {
  const storage = (globalThis.navigator as { storage?: { getDirectory?: unknown } } | undefined)?.storage;
  if (typeof globalThis.Worker !== 'function' || typeof storage?.getDirectory !== 'function') return Promise.reject(unavailable('opfs'));
  const worker = new Worker(new URL('./sqlite-worker.js', import.meta.url), { type: 'module', name: 'kernl-event-cache' });
  return connectSqliteWorker(worker as WorkerLike);
}

interface Session {
  readonly files: SqliteFiles;
  readonly base: string;
  readonly storage: FilenameStorage | undefined;
  readonly report: (event: CacheRecoveryEvent) => void;
}

async function openChecked(files: SqliteFiles, filename: string): Promise<SqliteDriver> {
  const driver = await files.open(filename);
  try {
    await checkAndMigrate(driver);
    return driver;
  } catch (error) {
    await closeQuietly(driver);
    throw error;
  }
}

/**
 * Open the database, repairing it when it is damaged: wipe the file and open it fresh; when the wipe fails
 * or the fresh file is damaged too, move to the next filename; when that is damaged as well, give up with
 * `unavailable:corrupt`. A damaged database is never read (D-027).
 */
async function openRepairing(session: Session, filename: string, damage?: unknown): Promise<{ driver: SqliteDriver; filename: string }> {
  let reason = damage === undefined ? '' : messageOf(damage);
  if (damage === undefined) {
    try {
      return { driver: await openChecked(session.files, filename), filename };
    } catch (error) {
      if (!isCorruptionError(error)) throw unavailable(`sqlite (${messageOf(error)})`);
      reason = messageOf(error);
    }
  }
  try {
    await session.files.wipe(filename);
    const driver = await openChecked(session.files, filename);
    session.report({ action: 'wiped', reason });
    return { driver, filename };
  } catch (error) {
    reason = messageOf(error);
  }
  const rotated = nextFilename(session.base, filename);
  try {
    const driver = await openChecked(session.files, rotated);
    session.storage?.setItem(FILENAME_KEY, rotated);
    session.report({ action: 'rotated', reason });
    return { driver, filename: rotated };
  } catch (error) {
    session.report({ action: 'disabled', reason: messageOf(error) });
    throw unavailable('corrupt');
  }
}

/** Where operations go once recovery has given up: every call is refused, and nothing is read from the damaged file. */
const DISABLED: SqliteDriver = {
  exec: () => Promise.reject(unavailable('corrupt')),
  query: () => Promise.reject(unavailable('corrupt')),
  close: async () => undefined,
};

async function openSqliteCache(session: Session, release: () => void) {
  let { driver, filename } = await openRepairing(session, session.storage?.getItem(FILENAME_KEY) ?? session.base);
  let recovering: Promise<void> | null = null;

  const recover = async (damage: unknown): Promise<void> => {
    await closeQuietly(driver);
    try {
      ({ driver, filename } = await openRepairing(session, filename, damage));
    } catch (error) {
      driver = DISABLED;
      throw error;
    } finally {
      recovering = null;
    }
  };

  // Every operation that meets damage shares one recovery, then is tried once more on the repaired file.
  // An operation whose driver was already replaced by the time it failed only retries.
  const run = async <T>(operation: (current: SqliteDriver) => Promise<T>): Promise<T> => {
    const used = driver;
    try {
      return await operation(used);
    } catch (error) {
      if (!isCorruptionError(error)) throw error;
      if (used === driver) await (recovering ??= recover(error));
      return operation(driver);
    }
  };

  const close = async (): Promise<void> => {
    await closeQuietly(driver);
    await session.files.close();
    release();
  };
  return createEventCache('sqlite-opfs', sqliteRecords(run, close));
}

/**
 * An adapter for a cache in sqlite-wasm over the origin-private file system. sqlite runs in a dedicated
 * worker on the SAH pool VFS, so the page needs no cross-origin isolation; sqlite-wasm is loaded only
 * inside that worker. The database is checked with `PRAGMA quick_check` on open, and damage found then or
 * later is repaired by wiping or rotating the file. A Web Lock keeps a second tab out; that tab falls back
 * to the next adapter.
 *
 * @param options - Filename, storage for the rotated filename, lock manager, connection and `onRecover`.
 * @returns The `sqlite-opfs` adapter. Its `open` rejects `unavailable:opfs`, `unavailable:locked`,
 *   `unavailable:corrupt` or `unavailable:sqlite (…)`.
 * @example
 * ```ts
 * import { createSqliteOpfsCacheAdapter, openEventCache } from '@kernlize/core/cache';
 *
 * const cache = await openEventCache([
 *   createSqliteOpfsCacheAdapter({ onRecover: ({ action, reason }) => console.warn(`event cache ${action}: ${reason}`) }),
 * ]);
 * ```
 */
export function createSqliteOpfsCacheAdapter(options: SqliteOpfsOptions = {}): EventCacheAdapter {
  const base = options.filename ?? DEFAULT_FILENAME;
  return {
    name: 'sqlite-opfs',
    open: async () => {
      const locks = options.locks ?? (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
      const release = locks ? await acquire(locks, `kernl:event-cache:${base}`) : () => undefined;
      if (!release) throw unavailable('locked');
      try {
        const files = await (options.connect ?? spawnWorker)().catch((error: unknown) => Promise.reject(unavailable(messageOf(error))));
        const storage = options.storage ?? (globalThis.localStorage as FilenameStorage | undefined);
        const session: Session = { files, base, storage, report: (event) => options.onRecover?.(event) };
        return await openSqliteCache(session, release).catch(async (error: unknown) => {
          await files.close();
          throw error;
        });
      } catch (error) {
        release();
        throw error;
      }
    },
  };
}
