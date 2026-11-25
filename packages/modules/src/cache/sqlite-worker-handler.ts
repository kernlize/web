import type { WorkerRequest, WorkerResponse } from './sqlite-worker-client.js';
import type { SqlStatement, SqlValue } from './types.js';

/** The part of sqlite-wasm's `oo1.DB` the worker uses. */
export interface WorkerDatabase {
  exec(options: { sql: string; bind?: readonly SqlValue[] }): unknown;
  exec(options: { sql: string; bind?: readonly SqlValue[]; rowMode: 'object'; returnValue: 'resultRows' }): Record<string, SqlValue>[];
  transaction(callback: (db: WorkerDatabase) => void): void;
  close(): void;
}

/** The part of sqlite-wasm's `SAHPoolUtil` the worker uses. */
export interface SahPool {
  readonly OpfsSAHPoolDb: new (filename: string) => WorkerDatabase;
  unlink(filename: string): boolean;
}

/** The part of the sqlite-wasm module the worker uses. */
export interface SahPoolSqlite {
  installOpfsSAHPoolVfs(options: { name: string }): Promise<SahPool>;
}

/** The worker's global scope, as the handler uses it. */
export interface WorkerScope {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function execOptions({ sql, params }: SqlStatement): { sql: string; bind?: readonly SqlValue[] } {
  return params?.length ? { sql, bind: params } : { sql };
}

/**
 * Answer the main thread's requests inside the worker: load sqlite once, install the SAH pool VFS, and run
 * statements against the databases it holds open. Errors go back as their message, so the main thread can
 * tell damage (`SQLITE_CORRUPT`, `SQLITE_NOTADB`) from other failures.
 *
 * @param scope - The worker's global scope.
 * @param load - Loads sqlite-wasm; called on the first request.
 */
export function attachSqliteWorker(scope: WorkerScope, load: () => Promise<SahPoolSqlite>): void {
  let installing: Promise<SahPool> | undefined;
  const databases = new Map<string, WorkerDatabase>();

  const pool = (): Promise<SahPool> =>
    (installing ??= load()
      .then((sqlite) => sqlite.installOpfsSAHPoolVfs({ name: 'kernl-sahpool' }))
      .catch((error: unknown) => Promise.reject(new Error(`unavailable:opfs (${messageOf(error)})`))));

  const database = (filename: string): WorkerDatabase => {
    const db = databases.get(filename);
    if (!db) throw new Error(`invalid:closed (${filename})`);
    return db;
  };

  const shut = (filename: string): void => {
    databases.get(filename)?.close();
    databases.delete(filename);
  };

  async function answer(request: WorkerRequest): Promise<unknown> {
    switch (request.op) {
      case 'init':
        await pool();
        return undefined;
      case 'open': {
        const { OpfsSAHPoolDb } = await pool();
        shut(request.filename);
        databases.set(request.filename, new OpfsSAHPoolDb(request.filename));
        return undefined;
      }
      case 'exec':
        database(request.filename).transaction((db) => request.statements.forEach((statement) => db.exec(execOptions(statement))));
        return undefined;
      case 'query':
        return database(request.filename).exec({ ...execOptions(request.statement), rowMode: 'object', returnValue: 'resultRows' });
      case 'close':
        shut(request.filename);
        return undefined;
      case 'wipe': {
        const sah = await pool();
        shut(request.filename);
        sah.unlink(request.filename);
        sah.unlink(`${request.filename}-journal`);
        return undefined;
      }
    }
  }

  scope.addEventListener('message', ({ data }) => {
    const request = data as WorkerRequest;
    void answer(request).then(
      (result) => scope.postMessage({ id: request.id, ok: true, result } satisfies WorkerResponse),
      (error: unknown) => scope.postMessage({ id: request.id, ok: false, error: messageOf(error) } satisfies WorkerResponse),
    );
  });
}
