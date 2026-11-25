import {
  getDeleteAddressPointers,
  getDeleteIds,
  getReplaceableAddress,
  getReplaceableIdentifier,
  isAddressableKind,
  isEphemeralKind,
  kinds,
  type Filter,
  type NostrEvent,
} from 'applesauce-core/helpers';
import type { EventCache } from './types.js';

/**
 * The storage a backend provides. It only keeps rows; every rule about which event wins lives in
 * {@link createEventCache}, so all backends behave the same.
 */
export interface EventRecords {
  /** Insert events, ignoring ids already present. */
  put(events: readonly NostrEvent[]): Promise<void>;
  /** Events matching one filter. Honouring `limit` is an optimisation; the caller applies it again. */
  query(filter: Filter): Promise<NostrEvent[]>;
  /** Remove events by id. */
  remove(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

const plain = ({ id, kind, pubkey, created_at, content, tags, sig }: NostrEvent): NostrEvent => ({ id, kind, pubkey, created_at, content, tags, sig });

/** NIP-01: the newer event wins; on equal timestamps the lower id does. */
const newer = (a: NostrEvent, b: NostrEvent): boolean => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

const newestFirst = (a: NostrEvent, b: NostrEvent): number => b.created_at - a.created_at || (a.id < b.id ? -1 : 1);

function unique(events: readonly NostrEvent[]): NostrEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

/** Keep only the newest version of each replaceable address in a batch. */
function newestPerAddress(events: readonly NostrEvent[]): NostrEvent[] {
  const byAddress = new Map<string, NostrEvent>();
  const regular: NostrEvent[] = [];
  for (const event of events) {
    const address = getReplaceableAddress(event);
    if (address === null) regular.push(event);
    else if (!byAddress.has(address) || newer(event, byAddress.get(address) as NostrEvent)) byAddress.set(address, event);
  }
  return [...regular, ...byAddress.values()];
}

function addressFilter(event: NostrEvent): Filter {
  const identifier = getReplaceableIdentifier(event);
  // An addressable event without a `d` tag has no tag row to look up, so it is found by kind and author alone.
  const tag = isAddressableKind(event.kind) && identifier !== '' ? { '#d': [identifier] } : {};
  return { kinds: [event.kind], authors: [event.pubkey], ...tag };
}

/** Whether a stored deletion by the event's author names it, by id or, for an addressable event, by address up to its time. */
function isDeletedBy(event: NostrEvent, deletions: readonly NostrEvent[]): boolean {
  const address = getReplaceableAddress(event);
  return deletions.some(
    (deletion) =>
      deletion.pubkey === event.pubkey &&
      (getDeleteIds(deletion).includes(event.id) ||
        (address !== null && deletion.created_at >= event.created_at && deletion.tags.some((tag) => tag[0] === 'a' && tag[1] === address))),
  );
}

/**
 * Give a backend kernl's cache rules: replaceable and addressable events keep only their newest version,
 * kind 5 deletions by the same author remove their targets and keep them out, ephemeral events are not
 * stored, and writes run one after another so two batches never race on the same address.
 *
 * @param name - The cache's name.
 * @param records - The backend's storage.
 * @returns An {@link EventCache} over `records`.
 * @example
 * ```ts
 * import { createEventCache, type EventRecords } from '@kernlize/core/cache';
 *
 * declare const records: EventRecords;
 * const cache = createEventCache('custom', records);
 * await cache.query([{ kinds: [0], limit: 1 }]);
 * ```
 */
export function createEventCache(name: string, records: EventRecords): EventCache {
  let writes: Promise<unknown> = Promise.resolve();

  async function query(filters: readonly Filter[]): Promise<NostrEvent[]> {
    const answers = await Promise.all(
      filters.map(async (filter) => {
        // Full-text search is a relay feature; no backend here indexes content.
        if (filter.search !== undefined) return [];
        const events = (await records.query(filter)).sort(newestFirst);
        return filter.limit === undefined ? events : events.slice(0, filter.limit);
      }),
    );
    return unique(answers.flat()).sort(newestFirst).map(plain);
  }

  async function applyDeletions(deletions: readonly NostrEvent[]): Promise<void> {
    const ids = deletions.flatMap(getDeleteIds);
    const pointers = deletions.flatMap(getDeleteAddressPointers);
    const filters: Filter[] = [
      ...(ids.length ? [{ ids }] : []),
      ...pointers.map((pointer) => ({ kinds: [pointer.kind], authors: [pointer.pubkey], ...(pointer.identifier ? { '#d': [pointer.identifier] } : {}) })),
    ];
    const targets = (await query(filters)).filter((event) => isDeletedBy(event, deletions));
    if (targets.length) await records.remove(targets.map((event) => event.id));
  }

  async function storeReplaceable(event: NostrEvent): Promise<boolean> {
    const address = getReplaceableAddress(event);
    const versions = (await records.query(addressFilter(event))).filter((stored) => getReplaceableAddress(stored) === address);
    if (versions.some((stored) => stored.id === event.id || newer(stored, event))) return false;
    if (versions.length) await records.remove(versions.map((stored) => stored.id));
    return true;
  }

  async function write(batch: readonly NostrEvent[]): Promise<void> {
    const events = unique(batch).filter((event) => !isEphemeralKind(event.kind));
    const deletions = events.filter((event) => event.kind === kinds.EventDeletion);
    if (deletions.length) {
      await records.put(deletions.map(plain));
      await applyDeletions(deletions);
    }
    const others = newestPerAddress(events.filter((event) => event.kind !== kinds.EventDeletion));
    if (!others.length) return;
    const known = await query([{ kinds: [kinds.EventDeletion], authors: [...new Set(others.map((event) => event.pubkey))] }]);
    const kept: NostrEvent[] = [];
    for (const event of others) {
      if (isDeletedBy(event, known)) continue;
      if (getReplaceableAddress(event) === null || (await storeReplaceable(event))) kept.push(plain(event));
    }
    if (kept.length) await records.put(kept);
  }

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = writes.then(task);
    writes = run.catch(() => undefined);
    return run;
  }

  return {
    name,
    add: (events) => serial(() => write(events)),
    query,
    removeByFilters: (filters) =>
      serial(async () => {
        const matched = await query(filters);
        if (matched.length) await records.remove(matched.map((event) => event.id));
        return matched.length;
      }),
    clear: () => serial(() => records.clear()),
    close: () => serial(() => records.close()),
  };
}
