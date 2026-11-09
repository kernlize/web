import type { NostrEvent } from '@napplet/core';

/** Deletion requests (NIP-09). */
export const DELETION_KIND = 5;

/** What a publisher withdrew: `pubkey|reference` to the newest deletion's time. */
export type Withdrawals = ReadonlyMap<string, number>;

const referenceKey = (pubkey: string, reference: string): string => `${pubkey}|${reference}`;

/**
 * Record what a deletion request withdraws. Only the author's own events and
 * addresses count: a deletion signed by someone else withdraws nothing.
 *
 * @param withdrawals - What was withdrawn so far.
 * @param deletion - A kind 5 event.
 * @returns The withdrawals including this request.
 * @example
 * ```ts
 * let withdrawn: Withdrawals = new Map();
 * withdrawn = withdraw(withdrawn, deletionEvent);
 * ```
 */
export function withdraw(withdrawals: Withdrawals, deletion: NostrEvent): Withdrawals {
  const next = new Map(withdrawals);
  for (const [name, value] of deletion.tags) {
    if ((name !== 'e' && name !== 'a') || typeof value !== 'string') continue;
    if (name === 'a' && value.split(':')[1] !== deletion.pubkey) continue;
    const key = referenceKey(deletion.pubkey, value);
    next.set(key, Math.max(next.get(key) ?? 0, deletion.created_at));
  }
  return next;
}

/**
 * Whether the publisher withdrew this manifest: its id was deleted, or its
 * address was deleted at or after the time it was published.
 *
 * @param event - A manifest event.
 * @param withdrawals - What publishers withdrew.
 * @returns True when the manifest should not be listed.
 * @example
 * ```ts
 * isWithdrawn(manifest, withdraw(new Map(), deletionOfIt)); // true
 * ```
 */
export function isWithdrawn(event: NostrEvent, withdrawals: Withdrawals): boolean {
  if (withdrawals.has(referenceKey(event.pubkey, event.id))) return true;
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
  const at = withdrawals.get(referenceKey(event.pubkey, `${event.kind}:${event.pubkey}:${identifier}`));
  return at !== undefined && at >= event.created_at;
}
