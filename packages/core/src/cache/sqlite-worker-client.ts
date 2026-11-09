import type { SqliteDriver, SqliteFiles, SqlStatement } from './types.js';

/** The part of a `Worker` the client uses. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message' | 'error', listener: (event: { data?: unknown; message?: string }) => void): void;
  terminate(): void;
}

/** A request to the sqlite worker. */
export type WorkerRequest =
  | { readonly id: number; readonly op: 'init' }
  | { readonly id: number; readonly op: 'open' | 'close' | 'wipe'; readonly filename: string }
  | { readonly id: number; readonly op: 'exec'; readonly filename: string; readonly statements: readonly SqlStatement[] }
  | { readonly id: number; readonly op: 'query'; readonly filename: string; readonly statement: SqlStatement };

/** The worker's answer to the request with the same id. */
export type WorkerResponse = { readonly id: number; readonly ok: true; readonly result?: unknown } | { readonly id: number; readonly ok: false; readonly error: string };

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

/** Distributes `Omit` over each member of a union, so each request keeps its own fields. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/**
 * Talk to the sqlite worker: one request per call, answered by id. The worker is asked to load sqlite and
 * install the SAH pool first, so a context without OPFS fails here rather than on the first query.
 *
 * @param worker - A started worker running the sqlite worker entry.
 * @returns The worker's database files.
 */
export async function connectSqliteWorker(worker: WorkerLike): Promise<SqliteFiles> {
  const pending = new Map<number, Pending>();
  let next = 0;
  worker.addEventListener('message', ({ data }) => {
    const response = data as WorkerResponse;
    const waiting = pending.get(response.id) as Pending;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response.result);
    else waiting.reject(new Error(response.error));
  });
  worker.addEventListener('error', (event) => {
    for (const waiting of pending.values()) waiting.reject(new Error(`unavailable:worker (${String(event.message)})`));
    pending.clear();
  });
  const call = <T>(request: WithoutId<WorkerRequest>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      next += 1;
      pending.set(next, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...request, id: next });
    });

  await call({ op: 'init' }).catch((error: unknown) => {
    worker.terminate();
    throw error;
  });
  return {
    open: async (filename): Promise<SqliteDriver> => {
      await call({ op: 'open', filename });
      return {
        exec: (statements) => call({ op: 'exec', filename, statements }),
        query: (statement) => call({ op: 'query', filename, statement }),
        close: () => call({ op: 'close', filename }),
      };
    },
    wipe: (filename) => call({ op: 'wipe', filename }),
    close: async () => worker.terminate(),
  };
}
