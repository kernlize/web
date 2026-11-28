import { afterEach, expect, it, vi } from 'vitest';
import type { OutboxCacheBacking } from '@kernlize/core';
import { browserOutboxCache } from './outbox-cache';

function session(values = new Map<string, string>()) {
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function lockManager() {
  const active = new Set<string>();
  return {
    async request(name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) {
      if (active.has(name)) return callback(null);
      active.add(name);
      try {
        await callback({});
      } finally {
        active.delete(name);
      }
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('uses only a namespace in sessionStorage and does not reuse a cloned tab namespace', async () => {
  const first = session();
  vi.stubGlobal('navigator', { locks: lockManager() });
  // Namespace claiming does not open the database until a cache operation.
  vi.stubGlobal('indexedDB', {});
  vi.stubGlobal('sessionStorage', first);
  const original = browserOutboxCache()!;
  await vi.waitFor(() => expect(first.values.size).toBe(1));
  const stable = [...first.values][0];
  expect(stable?.[1]).toMatch(/^[\da-f-]{36}$/u);

  const second = session(new Map(first.values));
  vi.stubGlobal('sessionStorage', second);
  const clone = browserOutboxCache()!;
  await vi.waitFor(() => expect([...second.values][0]?.[1]).not.toBe(stable?.[1]));
  expect([...first.values]).toEqual([stable]);

  original.close();
  // Let Web Locks release the closed page's claim before reopening.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.stubGlobal('sessionStorage', first);
  const setItem = vi.spyOn(first, 'setItem');
  const reloaded = browserOutboxCache()!;
  await vi.waitFor(() => expect(setItem).toHaveBeenCalledWith(...stable!));
  clone.close();
  reloaded.close();
  await expect(reloaded.visit(() => true)).rejects.toThrow('unavailable:outbox-cache-closed');
});

it('does not use IndexedDB if it cannot remember the tab or protect its namespace', async () => {
  const storage = { ...session(), setItem: () => { throw new DOMException('denied', 'SecurityError'); } };
  const open = vi.fn();
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('indexedDB', { open });
  vi.stubGlobal('navigator', {});
  expect(browserOutboxCache()).toBeUndefined();
  vi.stubGlobal('navigator', { locks: lockManager() });
  const cache: OutboxCacheBacking = browserOutboxCache()!;
  await expect(cache.visit(() => true)).rejects.toThrow('denied');
  expect(open).not.toHaveBeenCalled();
  cache.close();
});

it('rejects an observation when browser storage is no longer available', async () => {
  const request = {} as IDBOpenDBRequest;
  const open = vi.fn(() => request);
  vi.stubGlobal('sessionStorage', session());
  vi.stubGlobal('navigator', { locks: lockManager() });
  vi.stubGlobal('indexedDB', { open });
  const cache = browserOutboxCache()!;
  const writing = cache.observe({ id: 'event', pubkey: '', sig: '', kind: 31971, created_at: 1, content: '', tags: [] }, 'wss://nos.lol');
  await vi.waitFor(() => expect(open).toHaveBeenCalled());
  Object.defineProperty(request, 'error', { value: new DOMException('denied', 'SecurityError') });
  request.onerror!(new Event('error'));
  await expect(writing).rejects.toThrow('denied');
  cache.close();
});

it('does not open a cache without an exclusive tab namespace', async () => {
  vi.stubGlobal('sessionStorage', session());
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, callback: (lock: null) => unknown) => Promise.resolve(callback(null)) } });
  vi.stubGlobal('indexedDB', {});
  const cache = browserOutboxCache()!;
  await expect(cache.visit(() => true)).rejects.toThrow('unavailable:outbox-cache-tab');
  cache.close();
});

it('rejects an aborted database transaction', async () => {
  const request = {} as IDBOpenDBRequest;
  const transaction = { error: new DOMException('quota exceeded', 'QuotaExceededError'), objectStore: () => ({ index: () => ({ openCursor: () => ({}) }) }) } as unknown as IDBTransaction;
  const db = { transaction: vi.fn(() => transaction), close() {} };
  const open = vi.fn(() => request);
  vi.stubGlobal('sessionStorage', session());
  vi.stubGlobal('navigator', { locks: lockManager() });
  vi.stubGlobal('indexedDB', { open });
  vi.stubGlobal('IDBKeyRange', { bound() {} });
  const cache = browserOutboxCache()!;
  const reading = cache.visit(() => true);
  await vi.waitFor(() => expect(open).toHaveBeenCalled());
  Object.defineProperty(request, 'result', { value: db });
  request.onsuccess!(new Event('success'));
  await vi.waitFor(() => expect(db.transaction).toHaveBeenCalled());
  transaction.onabort!(new Event('abort'));
  await expect(reading).rejects.toThrow('quota exceeded');
  cache.close();
});
