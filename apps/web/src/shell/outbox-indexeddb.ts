import type { OutboxCacheBacking, OutboxCacheRecord } from '@kernlize/core';

const DATABASE = 'kernl-outbox-events';
const RECORDS = 'events';
const STATE = 'state';
const BUDGET_BYTES = 100 * 1024 * 1024;
const utf8 = new TextEncoder();

type Event = OutboxCacheRecord['event'];

interface Row extends OutboxCacheRecord {
  readonly tab: string;
  readonly inverseTime: number;
  readonly seen: number;
  readonly bytes: number;
}

interface Usage {
  bytes: number;
  seen: number;
}

function openDatabase(indexedDB: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const rows = db.createObjectStore(RECORDS, { keyPath: ['tab', 'event.id'] });
      rows.createIndex('creation', ['tab', 'inverseTime', 'event.id']);
      rows.createIndex('seen', 'seen');
      db.createObjectStore(STATE);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function transact(db: IDBDatabase, mode: IDBTransactionMode, run: (tx: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([RECORDS, STATE], mode);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    run(tx);
  });
}

function visit(db: IDBDatabase, tab: string, visitor: Parameters<OutboxCacheBacking['visit']>[0]): Promise<void> {
  return transact(db, 'readonly', (tx) => {
    const range = IDBKeyRange.bound([tab], [tab, []], false, true);
    const request = tx.objectStore(RECORDS).index('creation').openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && visitor(cursor.value as Row)) cursor.continue();
    };
  });
}

function saveUsage(tx: IDBTransaction, usage: Usage, budget: number): void {
  const state = tx.objectStore(STATE);
  if (usage.bytes <= budget) {
    state.put(usage, 'usage');
    return;
  }
  const request = tx.objectStore(RECORDS).index('seen').openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor || usage.bytes <= budget) {
      state.put(usage, 'usage');
      return;
    }
    usage.bytes -= (cursor.value as Row).bytes;
    cursor.delete();
    cursor.continue();
  };
}

function observe(db: IDBDatabase, tab: string, event: Event, relay: string, budget: number): Promise<void> {
  return transact(db, 'readwrite', (tx) => {
    const rows = tx.objectStore(RECORDS);
    const lookup = rows.get([tab, event.id]);
    const usage = tx.objectStore(STATE).get('usage');
    usage.onsuccess = () => {
      const previous = lookup.result as Row | undefined;
      const totals = (usage.result ?? { bytes: 0, seen: 0 }) as Usage;
      const relays = [...new Set([...(previous?.relays ?? []), relay])];
      const value = { tab, inverseTime: -event.created_at, seen: totals.seen + 1, relays, event };
      const bytes = utf8.encode(JSON.stringify(value)).byteLength;
      if (bytes > budget) return;
      totals.seen = value.seen;
      totals.bytes += bytes - (previous?.bytes ?? 0);
      rows.put({ ...value, bytes } satisfies Row);
      saveUsage(tx, totals, budget);
    };
  });
}

/** Independent event records and an origin-wide byte budget, with tab-scoped reads. */
export function createIndexedDbOutboxCache(indexedDB: IDBFactory, tab: string, budget = BUDGET_BYTES): OutboxCacheBacking {
  let opening: Promise<IDBDatabase> | undefined;
  let closed = false;
  const database = () => closed ? Promise.reject(new Error('unavailable:outbox-cache-closed')) : (opening ??= openDatabase(indexedDB));
  return {
    async visit(visitor) {
      await visit(await database(), tab, visitor);
    },
    async observe(event, relay) {
      await observe(await database(), tab, event, relay, budget);
    },
    close() {
      closed = true;
      void opening?.then((db) => db.close(), () => undefined);
    },
  };
}
