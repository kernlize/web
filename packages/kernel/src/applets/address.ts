import { naddrEncode, neventEncode } from 'applesauce-core/helpers';
import { NAPPLET_KIND_SNAPSHOT } from '@kehto/nip/5d';
import type { NostrEvent } from '@napplet/core';

/**
 * The address a person can paste back into the launcher for this manifest.
 *
 * @param event - A napplet manifest event.
 * @param relays - Where it was found; carried as hints, never as identity.
 * @returns `nevent1…` for a snapshot, `naddr1…` for a root or named applet.
 * @example
 * ```ts
 * addressOf(manifest, ['wss://relay.napplet.soy']); // 'naddr1…'
 * ```
 */
export function addressOf(event: NostrEvent, relays: readonly string[] = []): string {
  if (event.kind === NAPPLET_KIND_SNAPSHOT) return neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays: [...relays] });
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
  return naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier, relays: [...relays] });
}
