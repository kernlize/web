import type { ISigner } from 'applesauce-signers';
import type { StorageAdapter } from 'nostr-double-ratchet';
import type { StorageLike } from '../types.js';

/** NIP-44 encrypts at most 65535 bytes; a UTF-16 code unit takes at most three UTF-8 bytes, so 16384 units always fit. */
const CHUNK_UNITS = 16_384;

interface SlotIndex {
  next: number;
  slots: Record<string, number>;
}

/**
 * What {@link createSealedRatchetStorage} needs.
 *
 * @example
 * ```ts
 * const options: SealedRatchetStorageOptions = { storage: localStorage, signer: account, owner: account.pubkey };
 * ```
 */
export interface SealedRatchetStorageOptions {
  readonly storage: StorageLike;
  /** The account signer; every value is encrypted to `owner` with its `nip44`. */
  readonly signer: ISigner;
  readonly owner: string;
}

function chunks(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += CHUNK_UNITS) parts.push(text.slice(start, start + CHUNK_UNITS));
  return parts;
}

/**
 * The ratchet library's storage, sealed to the account. The library keeps its
 * device key and session state here; kernl writes each value only as
 * ciphertext the account signer encrypted to itself with `nip44`, under an
 * opaque slot number, and keeps the map from the library's key names (which
 * name correspondents) to slots in one more sealed entry. Nothing readable
 * reaches `storage`, so the key rule in `SOUL.md` opinion 1 holds for every
 * secret the library generates (D-016).
 *
 * Values are decrypted once and then served from memory, so an extension or
 * remote signer is asked once per value per page load. Writes are applied in
 * order.
 *
 * @param options - Backing storage, the account signer and its public key.
 * @returns A `StorageAdapter` for `NdrRuntime`.
 * @example
 * ```ts
 * const storage = createSealedRatchetStorage({ storage: localStorage, signer: account, owner: account.pubkey });
 * await storage.put('v1/note', { hello: 'world' });
 * await storage.get('v1/note'); // { hello: 'world' }
 * ```
 */
export function createSealedRatchetStorage(options: SealedRatchetStorageOptions): StorageAdapter {
  const { storage, owner } = options;
  const nip44 = options.signer.nip44 as NonNullable<ISigner['nip44']>;
  const prefix = `kernl:ratchet:v1:${owner}:`;
  const values = new Map<string, unknown>();
  let writes: Promise<void> = Promise.resolve();

  const seal = async (value: unknown): Promise<string> => {
    const parts = await Promise.all(chunks(JSON.stringify(value)).map((part) => nip44.encrypt(owner, part)));
    return JSON.stringify(parts);
  };
  const open = async <T>(raw: string): Promise<T> => {
    const parts = await Promise.all((JSON.parse(raw) as string[]).map((part) => nip44.decrypt(owner, part)));
    return JSON.parse(parts.join('')) as T;
  };

  const readIndex = async (): Promise<SlotIndex> => {
    const raw = storage.getItem(`${prefix}index`);
    return raw === null ? { next: 0, slots: {} } : open<SlotIndex>(raw);
  };
  const loading = readIndex();
  const write = (task: (index: SlotIndex) => Promise<void>): Promise<void> => {
    writes = writes.then(async () => task(await loading));
    return writes;
  };
  const saveIndex = async (index: SlotIndex): Promise<void> => storage.setItem(`${prefix}index`, await seal(index));

  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      if (values.has(key)) return values.get(key) as T;
      const slot = (await loading).slots[key];
      const raw = slot === undefined ? null : storage.getItem(`${prefix}${slot}`);
      if (raw === null) return undefined;
      const value = await open<T>(raw);
      if (!values.has(key)) values.set(key, value);
      return values.get(key) as T;
    },
    put<T = unknown>(key: string, value: T): Promise<void> {
      values.set(key, value);
      return write(async (index) => {
        const known = index.slots[key];
        const slot = known ?? index.next;
        storage.setItem(`${prefix}${slot}`, await seal(value));
        if (known !== undefined) return;
        index.slots[key] = slot;
        index.next = slot + 1;
        await saveIndex(index);
      });
    },
    del(key: string): Promise<void> {
      values.delete(key);
      return write(async (index) => {
        const slot = index.slots[key];
        if (slot === undefined) return;
        storage.removeItem(`${prefix}${slot}`);
        delete index.slots[key];
        await saveIndex(index);
      });
    },
    async list(match = ''): Promise<string[]> {
      await writes;
      return Object.keys((await loading).slots).filter((key) => key.startsWith(match));
    },
  };
}
