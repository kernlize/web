import init from '@sqlite.org/sqlite-wasm';
import { attachSqliteWorker, type SahPool, type SahPoolSqlite, type WorkerDatabase, type WorkerScope } from '../../src/cache/sqlite-worker-handler.js';
import type { WorkerLike } from '../../src/cache/sqlite-worker-client.js';
import type { SqlValue } from '../../src/cache/types.js';

// Real sqlite-wasm, in memory: the pool below keeps each file as the bytes of a serialised database, so damage is
// sqlite's own `SQLITE_NOTADB` and `SQLITE_CORRUPT`, not a thrown string.
const sqlite3 = await init();
type Db = InstanceType<typeof sqlite3.oo1.DB>;

const DESERIALIZE = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;

/** Bytes no sqlite header starts with: opening them reads as `file is not a database`. */
export const NOT_A_DATABASE = new Uint8Array(4096).fill(7);

function load(db: Db, bytes: Uint8Array): void {
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  sqlite3.capi.sqlite3_deserialize(db.pointer as number, 'main', pointer, bytes.length, bytes.length, DESERIALIZE);
}

/** A healthy database with one of its b-tree pages overwritten: `PRAGMA quick_check` reports it malformed. */
export function malformedDatabase(): Uint8Array {
  const db = new sqlite3.oo1.DB(':memory:');
  db.exec('CREATE TABLE filler (value TEXT); CREATE INDEX filler_value ON filler (value);');
  const padding = 'x'.repeat(100);
  for (let at = 0; at < 500; at += 1) db.exec({ sql: 'INSERT INTO filler VALUES (?)', bind: [padding + String(at)] });
  const bytes = sqlite3.capi.sqlite3_js_db_export(db);
  db.close();
  bytes.fill(0xff, 4096 * 2, 4096 * 2 + 3000);
  return bytes;
}

/** What a closed file leaves on disk: its pages, or, when sqlite cannot read them any more, the damage. */
function exported(db: Db): Uint8Array {
  try {
    return sqlite3.capi.sqlite3_js_db_export(db);
  } catch {
    return NOT_A_DATABASE;
  }
}

/** A database whose schema says NOT NULL over a row holding NULL: whole pages, but `PRAGMA quick_check` lists the problem. */
export function inconsistentDatabase(): Uint8Array {
  const db = new sqlite3.oo1.DB(':memory:');
  db.exec('CREATE TABLE filler (value TEXT); INSERT INTO filler VALUES (NULL);');
  db.exec("PRAGMA writable_schema = ON; UPDATE sqlite_schema SET sql = 'CREATE TABLE filler (value TEXT NOT NULL)' WHERE name = 'filler'; PRAGMA writable_schema = OFF;");
  const bytes = sqlite3.capi.sqlite3_js_db_export(db);
  db.close();
  return bytes;
}

/** One open file of the fake pool, delegating to a real in-memory sqlite database. */
export class PoolFile implements WorkerDatabase {
  busy = false;
  failCloseOnce = false;
  private readonly db = new sqlite3.oo1.DB(':memory:');

  constructor(
    private readonly pool: FakeSahPool,
    private readonly filename: string,
  ) {
    // Some VFS code throws plain values rather than errors; the worker must pass those on too.
    if (pool.openFails) throw pool.openFails;
    const bytes = pool.everyFileDamaged ? NOT_A_DATABASE : pool.files.get(filename);
    if (bytes) load(this.db, bytes);
    pool.open.set(filename, this);
  }

  exec(options: { sql: string; bind?: readonly SqlValue[] }): unknown;
  exec(options: { sql: string; bind?: readonly SqlValue[]; rowMode: 'object'; returnValue: 'resultRows' }): Record<string, SqlValue>[];
  exec(options: { sql: string; bind?: readonly SqlValue[] }): unknown {
    if (this.busy) throw new Error('SQLITE_BUSY: database is locked');
    return this.db.exec(options as Parameters<Db['exec']>[0]);
  }

  transaction(callback: (db: WorkerDatabase) => void): void {
    this.db.transaction(() => callback(this));
  }

  close(): void {
    if (this.failCloseOnce) {
      this.failCloseOnce = false;
      throw new Error('SQLITE_IOERR: close failed');
    }
    this.pool.files.set(this.filename, exported(this.db));
    this.db.close();
    this.pool.open.delete(this.filename);
  }

  damage(): void {
    load(this.db, NOT_A_DATABASE);
  }
}

/** The OPFS SAH pool as the worker sees it, with switches for the ways a real one fails. */
export class FakeSahPool implements SahPool {
  readonly files = new Map<string, Uint8Array>();
  readonly open = new Map<string, PoolFile>();
  everyFileDamaged = false;
  unlinkFails = false;
  openFails: string | null = null;
  readonly OpfsSAHPoolDb: new (filename: string) => WorkerDatabase;

  constructor() {
    const pool = (): FakeSahPool => this;
    this.OpfsSAHPoolDb = class extends PoolFile {
      constructor(filename: string) {
        super(pool(), filename);
      }
    };
  }

  unlink(filename: string): boolean {
    if (this.unlinkFails) throw new Error(`cannot remove ${filename}`);
    return this.files.delete(filename);
  }
}

/** sqlite-wasm as the worker loads it, with its SAH pool replaced by the fake. */
export function sqliteOver(pool: FakeSahPool): SahPoolSqlite {
  return { installOpfsSAHPoolVfs: async () => pool };
}

/** A worker running in this thread: messages cross as structured clones, one task later, as they would. */
export class InProcessWorker implements WorkerLike {
  terminated = false;
  crashOnStart = false;
  private readonly listeners = { message: [] as ((event: { data?: unknown; message?: string }) => void)[], error: [] as ((event: { message?: string }) => void)[] };
  private readonly inbound: ((event: { data: unknown }) => void)[] = [];
  readonly scope: WorkerScope = {
    addEventListener: (_type, listener) => this.inbound.push(listener),
    postMessage: (message) => setTimeout(() => this.listeners.message.forEach((listener) => listener({ data: structuredClone(message) }))),
  };

  constructor(readonly ready: Promise<unknown> = Promise.resolve()) {}

  postMessage(message: unknown): void {
    if (this.crashOnStart) {
      setTimeout(() => this.listeners.error.forEach((listener) => listener({ message: 'worker script failed' })));
      return;
    }
    void this.ready.then(() => setTimeout(() => this.inbound.forEach((listener) => listener({ data: structuredClone(message) }))));
  }

  addEventListener(type: 'message' | 'error', listener: (event: { data?: unknown; message?: string }) => void): void {
    this.listeners[type].push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** A worker running the handler over the fake pool. */
export function poolWorker(pool: FakeSahPool): InProcessWorker {
  const worker = new InProcessWorker();
  attachSqliteWorker(worker.scope, async () => sqliteOver(pool));
  return worker;
}
