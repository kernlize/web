import { catchError, EMPTY, lastValueFrom, takeUntil, tap, timer } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import { decodePointer } from 'applesauce-core/helpers';
import type { NostrEvent } from '@napplet/core';
import { asFilters, type ApplesaucePool } from '../applesauce/relay-hooks.js';

/** A person, and where whoever shared them said their data is kept. */
export interface PersonPointer {
  /** The identity, as 64 lowercase hex characters. */
  readonly pubkey: string;
  /** Servers named alongside the identity; empty when none were. */
  readonly relays: readonly string[];
}

const URI_SCHEME = /^nostr:/i;
const SOCKET_URL = /^wss?:\/\//i;
const HEX_KEY = /^[0-9a-f]{64}$/;
const NO_RELAYS: readonly string[] = Object.freeze([]);

function decodeOrNothing(text: string): ReturnType<typeof decodePointer> | undefined {
  try {
    return decodePointer(text);
  } catch {
    return undefined;
  }
}

/**
 * The longest the hinted servers are waited for before a lookup goes on
 * without them. An outer bound only: it ends as soon as they have all answered.
 *
 * @example
 * ```ts
 * createPeople({ store, pool, timeoutMs: PERSON_HINT_TIMEOUT_MS });
 * ```
 */
export const PERSON_HINT_TIMEOUT_MS = 8_000;

/** What says who a person is and where they read and are written to: profile, server list, message inboxes. */
const PERSON_KINDS = [0, 10002, 10050];

/**
 * Read an identity out of what someone typed, pasted or was sent.
 *
 * Every NIP-19 form of a person is one: 64 hex characters, an `npub`, or an
 * `nprofile`, with or without a `nostr:` prefix and in any case. An
 * `nprofile` carries the servers its data is on, which come back as `relays`.
 *
 * @param input - The text.
 * @returns The person, or `undefined` when the text is none of those.
 * @example
 * ```ts
 * parsePerson('npub1…'); // { pubkey: '3bf0…', relays: [] }
 * parsePerson('nostr:nprofile1…'); // { pubkey: '3bf0…', relays: ['wss://relay.example'] }
 * parsePerson('hello'); // undefined
 * ```
 */
export function parsePerson(input: string): PersonPointer | undefined {
  const text = input.trim().replace(URI_SCHEME, '').toLowerCase();
  if (HEX_KEY.test(text)) return Object.freeze({ pubkey: text, relays: NO_RELAYS });
  const decoded = decodeOrNothing(text);
  if (decoded?.type === 'npub') return Object.freeze({ pubkey: decoded.data, relays: NO_RELAYS });
  // An address of anything else, or a secret key, is not a person, whatever key it happens to hold.
  if (decoded?.type !== 'nprofile') return undefined;
  // The decoder always gives an nprofile its list of servers, empty when it names none; only the type says otherwise.
  const named = decoded.data.relays as readonly string[];
  return Object.freeze({ pubkey: decoded.data.pubkey, relays: Object.freeze(named.filter((url) => SOCKET_URL.test(url))) });
}

/** Options for {@link createPeople}. */
export interface PeopleOptions {
  /** The shell's event store; what the hinted servers hold is put here, where every lookup reads first. */
  readonly store: EventStore;
  readonly pool: ApplesaucePool;
  /** Outer bound on waiting for the hinted servers; {@link PERSON_HINT_TIMEOUT_MS} by default. */
  readonly timeoutMs?: number;
}

/** Finds people from any form of their identity. */
export interface People {
  /** Read an identity; `undefined` when the text is not one. Asks nobody. */
  parse(input: string): PersonPointer | undefined;
  /**
   * Read an identity and, when it names servers, fetch the person's profile,
   * server list and message inboxes from them first, so whatever looks the
   * person up next finds them.
   *
   * @throws `invalid:person` when the text is not an identity.
   */
  locate(input: string): Promise<string>;
}

/**
 * Create the shell's way of finding a person from what was typed or sent.
 *
 * The servers an `nprofile` names are asked once per person and set of
 * servers, and what they hold is added to the shell's event store. A server
 * that fails or says nothing costs nothing: the lookup goes on with the
 * shell's own servers, as it would have without the hint.
 *
 * @param options - The event store, the pool and the outer bound.
 * @returns The finder.
 * @example
 * ```ts
 * const people = createPeople({ store: eventStore, pool });
 * const pubkey = await people.locate('nprofile1…');
 * ```
 */
export function createPeople(options: PeopleOptions): People {
  const asked = new Map<string, Promise<void>>();

  const ask = (person: PersonPointer): Promise<void> => {
    const key = `${person.pubkey}:${[...person.relays].sort().join(',')}`;
    const known = asked.get(key);
    if (known) return known;
    const done = lastValueFrom(
      options.pool.request([...person.relays], asFilters([{ kinds: PERSON_KINDS, authors: [person.pubkey] }])).pipe(
        takeUntil(timer(options.timeoutMs ?? PERSON_HINT_TIMEOUT_MS)),
        tap((event: NostrEvent) => options.store.add(event)),
        catchError(() => EMPTY),
      ),
      { defaultValue: undefined },
    ).then(() => undefined);
    asked.set(key, done);
    return done;
  };

  return {
    parse: parsePerson,
    async locate(input) {
      const person = parsePerson(input);
      if (!person) throw new Error('invalid:person');
      if (person.relays.length > 0) await ask(person);
      return person.pubkey;
    },
  };
}
