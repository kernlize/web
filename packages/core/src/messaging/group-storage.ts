import { bytesToHex, hexToBytes } from 'applesauce-core/helpers';
import type { ISigner } from 'applesauce-signers';
import type { GenericKeyValueStore } from '@internet-privacy/marmot-ts';
import type { StorageLike } from '../types.js';

/** NIP-44 encrypts at most 65535 bytes; a UTF-16 code unit takes at most three UTF-8 bytes, so 16384 units always fit. */
const SEAL_UNITS = 16_384;

/** What {@link createSealedGroupStore} needs. */
export interface SealedGroupStoreOptions {
  readonly storage: StorageLike;
  /** The account signer; the store is encrypted to `owner` with its `nip44`. */
  readonly signer: ISigner;
  readonly owner: string;
}

/** The group library keeps bytes and big integers; JSON keeps neither, so both are tagged. */
function encode(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: bytesToHex(value) };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  return value;
}

function decode(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if ('$bytes' in value) return hexToBytes(String(value.$bytes));
  if ('$bigint' in value) return BigInt(String(value.$bigint));
  return value;
}

/**
 * One of the group library's key-value stores, sealed to the account. The
 * library keeps group secrets, its own signing keys and pending invites in
 * these stores; kernl writes each store to `storage` as one value that the
 * account signer encrypted to itself with `nip44`, split into parts NIP-44
 * can carry. Nothing readable reaches `storage`, so the key rule in
 * `SOUL.md` opinion 1 holds for every secret the library generates (D-018).
 *
 * The store is decrypted once and then served from memory, so an extension
 * or remote signer is asked once per store per page load. Writes are applied
 * in order.
 *
 * @param options - Backing storage, the account signer and its public key.
 * @param name - Which of the library's stores this is; part of the storage key.
 * @returns A `GenericKeyValueStore` for `MarmotClient`.
 * @example
 * ```ts
 * const groupStateStore = createSealedGroupStore({ storage: localStorage, signer: account, owner: account.pubkey }, 'groups');
 * await groupStateStore.setItem('note', new Uint8Array([1, 2]));
 * await groupStateStore.getItem('note'); // Uint8Array [1, 2]
 * ```
 */
export function createSealedGroupStore<T>(options: SealedGroupStoreOptions, name: string): GenericKeyValueStore<T> {
  const { storage, owner } = options;
  const nip44 = options.signer.nip44 as NonNullable<ISigner['nip44']>;
  const key = `kernl:group:v1:${owner}:${name}`;

  const open = async (): Promise<Map<string, T>> => {
    const raw = storage.getItem(key);
    if (raw === null) return new Map();
    const parts = await Promise.all((JSON.parse(raw) as string[]).map((part) => nip44.decrypt(owner, part)));
    return new Map(Object.entries(JSON.parse(parts.join(''), decode) as Record<string, T>));
  };
  const loading = open();
  let writes: Promise<unknown> = loading;

  const seal = async (entries: Map<string, T>): Promise<void> => {
    const text = JSON.stringify(Object.fromEntries(entries), encode);
    const parts: string[] = [];
    for (let start = 0; start < text.length; start += SEAL_UNITS) parts.push(text.slice(start, start + SEAL_UNITS));
    storage.setItem(key, JSON.stringify(await Promise.all(parts.map((part) => nip44.encrypt(owner, part)))));
  };
  const write = (change: (entries: Map<string, T>) => void): Promise<void> => {
    const next = writes.then(async () => {
      const entries = await loading;
      change(entries);
      await seal(entries);
    });
    writes = next;
    return next;
  };

  return {
    async getItem(item) {
      return (await loading).get(item) ?? null;
    },
    async setItem(item, value) {
      await write((entries) => entries.set(item, value));
      return value;
    },
    removeItem: (item) => write((entries) => entries.delete(item)),
    clear: () => write((entries) => entries.clear()),
    async keys() {
      return [...(await loading).keys()];
    },
  };
}
