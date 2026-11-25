import type { StorageLike } from '../types.js';

/** A prefixed JSON view over a {@link StorageLike}. */
export interface NamespacedStore {
  /** Read and parse a value; `fallback` when the key is absent or unreadable. */
  getJson<T>(key: string, fallback: T): T;
  /** Serialise and write a value. */
  setJson(key: string, value: unknown): void;
  remove(key: string): void;
}

type ParsedJson = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

function parseJson(raw: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/**
 * Create a store that keeps every kernl key under one prefix, so the host's
 * storage can also hold kehto's and the app's own keys without collisions.
 *
 * Corrupt JSON reads as the fallback rather than throwing: persisted state is
 * a convenience, and a damaged value must never stop the shell from booting.
 *
 * @param storage - Synchronous key-value storage; `localStorage` or a Map-backed fake.
 * @param prefix - Namespace prepended to every key, for example `kernl`.
 * @returns A namespaced JSON store.
 * @example
 * ```ts
 * const store = createNamespacedStore(localStorage, 'kernl');
 * store.setJson('relays:v1', { apps: ['wss://relay.napplet.soy'] });
 * store.getJson('relays:v1', {}); // { apps: [...] }
 * ```
 */
export function createNamespacedStore(storage: StorageLike, prefix: string): NamespacedStore {
  const keyFor = (key: string): string => `${prefix}:${key}`;
  return {
    getJson<T>(key: string, fallback: T): T {
      const raw = storage.getItem(keyFor(key));
      if (raw === null) return fallback;
      const parsed = parseJson(raw);
      return parsed.ok ? (parsed.value as T) : fallback;
    },
    setJson(key, value) {
      storage.setItem(keyFor(key), JSON.stringify(value));
    },
    remove(key) {
      storage.removeItem(keyFor(key));
    },
  };
}
