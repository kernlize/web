import { decodeAddressPointer, decodeEventPointer } from 'applesauce-core/helpers';
import type { AppletPointer } from '../types.js';
import { decodeBuiltin } from './builtin.js';

const HEX_64 = /^[0-9a-f]{64}$/;
const COORDINATE = /^([0-9a-f]{64}):(\d+):(.*)$/s;
const A_TAG_COORDINATE = /^(\d+):([0-9a-f]{64}):(.*)$/s;
/** An encoded address anywhere in the text, so one copied as a link or inside a sentence still opens. */
const ENCODED = /(?:naddr|nevent|note)1[02-9ac-hj-np-z]+/i;

function invalid(): never {
  throw new Error('invalid:pointer');
}

function relays(hints: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(hints ?? [])]);
}

function fromCoordinate(pubkey: string, kind: string, identifier: string): AppletPointer {
  return { kind: 'address', pubkey, identifier, eventKind: Number(kind), relays: Object.freeze([]) };
}

function fromBech32(input: string): AppletPointer | undefined {
  if (input.startsWith('naddr1')) {
    const pointer = decodeAddressPointer(input);
    if (!pointer) invalid();
    return { kind: 'address', pubkey: pointer.pubkey, identifier: pointer.identifier, eventKind: pointer.kind, relays: relays(pointer.relays) };
  }
  if (input.startsWith('nevent1') || input.startsWith('note1')) {
    const pointer = decodeEventPointer(input);
    if (!pointer) invalid();
    return pointer.author
      ? { kind: 'event', id: pointer.id, relays: relays(pointer.relays), author: pointer.author }
      : { kind: 'event', id: pointer.id, relays: relays(pointer.relays) };
  }
  return undefined;
}

/**
 * Decode what a user typed or clicked into the event to fetch.
 *
 * Accepts `naddr1…`, `nevent1…`, `note1…`, a bare 64-hex event id, any of
 * those behind a `nostr:` prefix, and plain coordinates in either
 * `<pubkey>:<kind>:<identifier>` or NIP-01 `<kind>:<pubkey>:<identifier>`
 * order. An encoded address is also found inside a link or a sentence, since
 * that is how addresses are shared. The result says which event to fetch and
 * nothing more; trust comes from verifying that event, never from the pointer.
 *
 * @param input - The address text.
 * @returns The decoded pointer.
 * @throws `invalid:pointer` for anything else.
 * @example
 * ```ts
 * decodePointer('nostr:naddr1…').kind; // 'address'
 * decodePointer(`${pubkey}:35129:chat`); // { kind: 'address', pubkey, identifier: 'chat', eventKind: 35129, relays: [] }
 * decodePointer('https://applets.example/n/naddr1…?ref=share').kind; // 'address'
 * ```
 */
export function decodePointer(input: string): AppletPointer {
  const text = input.trim().replace(/^nostr:/i, '');
  const builtin = decodeBuiltin(text);
  if (builtin) return builtin;
  if (HEX_64.test(text)) return { kind: 'event', id: text, relays: Object.freeze([]) };

  const coordinate = COORDINATE.exec(text);
  if (coordinate) return fromCoordinate(coordinate[1] as string, coordinate[2] as string, coordinate[3] as string);
  const aTag = A_TAG_COORDINATE.exec(text);
  if (aTag) return fromCoordinate(aTag[2] as string, aTag[1] as string, aTag[3] as string);

  return fromBech32((ENCODED.exec(text)?.[0] ?? text).toLowerCase()) ?? invalid();
}
