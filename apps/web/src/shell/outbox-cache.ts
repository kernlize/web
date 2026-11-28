import type { OutboxCacheBacking } from '@kernlize/core';
import { createIndexedDbOutboxCache } from './outbox-indexeddb';

const TAB_KEY = 'kernl:outbox-tab:v1';

function claim(locks: LockManager, tab: string): Promise<(() => void) | undefined> {
  return new Promise((resolve, reject) => {
    void locks.request(`kernl:outbox-tab:${tab}`, { ifAvailable: true }, (lock) => {
      if (!lock) return resolve(undefined);
      return new Promise<void>((release) => resolve(release));
    }).catch(reject);
  });
}

async function openTab(session: Storage, locks: LockManager, factory: IDBFactory) {
  const saved = session.getItem(TAB_KEY);
  // Duplicating a tab can copy sessionStorage. Only the current lock holder may reuse that namespace.
  const lock = saved && /^[\da-f-]{36}$/u.test(saved) ? await claim(locks, saved) : undefined;
  const tab = lock ? saved! : crypto.randomUUID();
  const release = lock ?? await claim(locks, tab);
  if (!release) throw new Error('unavailable:outbox-cache-tab');
  try {
    session.setItem(TAB_KEY, tab);
    return { cache: createIndexedDbOutboxCache(factory, tab), release };
  } catch (error) {
    release();
    throw error;
  }
}

export function browserOutboxCache(): OutboxCacheBacking | undefined {
  try {
    const { sessionStorage, indexedDB, navigator } = globalThis;
    const locks = navigator?.locks;
    if (!sessionStorage || !indexedDB || !locks) return undefined;
    const opening = openTab(sessionStorage, locks, indexedDB);
    void opening.catch(() => undefined);
    let closed = false;
    const open = () => closed ? Promise.reject(new Error('unavailable:outbox-cache-closed')) : opening;
    return {
      async visit(visitor) { await (await open()).cache.visit(visitor); },
      async observe(event, relay) { await (await open()).cache.observe(event, relay); },
      close() {
        closed = true;
        void opening.then(({ cache, release }) => {
          cache.close();
          release();
        }, () => undefined);
      },
    };
  } catch {
    return undefined;
  }
}
