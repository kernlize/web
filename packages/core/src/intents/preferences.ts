import type { EventTemplate, NostrEvent } from '@napplet/core';

/**
 * The addressable kind that records a user's preferred handlers, one event
 * per archetype ("Napplet Handler Preferences", kind 31129).
 *
 * @example
 * ```ts
 * pool.request(relays, [{ kinds: [HANDLER_PREFERENCES_KIND], authors: [pubkey] }]);
 * ```
 */
export const HANDLER_PREFERENCES_KIND = 31129;

/** The public entries of one kind-31129 event. Private entries in `content` are kept, not read. */
export interface HandlerPreferences {
  readonly archetype: string;
  /** Archetype-wide `a` and `e` references, in tag order. */
  readonly handlers: readonly string[];
  /** Intent-specific `i` references by convention identity, in tag order. */
  readonly intents: Readonly<Record<string, readonly string[]>>;
}

const HEX_64 = /^[0-9a-f]{64}$/;
const NAMED = /^35129:([0-9a-f]{64}):(.+)$/s;
const ROOT = /^15129:([0-9a-f]{64}):$/;
const CONVENTION = /^napplet:([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;

/**
 * kehto's catalogue id for a preference reference: a named or root
 * coordinate, or a snapshot id. kehto keys named applets by publisher, kind
 * and `d`, roots by publisher and kind, snapshots by event id.
 *
 * @param ref - `35129:<pubkey>:<d>`, `15129:<pubkey>:` or a 64-hex snapshot id.
 * @returns The catalogue id, or undefined for anything else.
 * @example
 * ```ts
 * catalogIdForRef(`35129:${pubkey}:notepad`); // `nip5d:35129:${pubkey}:notepad`
 * ```
 */
export function catalogIdForRef(ref: string): string | undefined {
  if (HEX_64.test(ref)) return `nip5d:5129:${ref}`;
  const named = NAMED.exec(ref);
  if (named) return `nip5d:35129:${named[1] as string}:${named[2] as string}`;
  const root = ROOT.exec(ref);
  return root ? `nip5d:15129:${root[1] as string}` : undefined;
}

/**
 * The preference reference for a catalogue id; the inverse of {@link catalogIdForRef}.
 *
 * @param catalogId - A kehto catalogue id.
 * @returns The coordinate or snapshot id, or undefined when the id is not a napplet's.
 * @example
 * ```ts
 * refForCatalogId(`nip5d:15129:${pubkey}`); // `15129:${pubkey}:`
 * ```
 */
export function refForCatalogId(catalogId: string): string | undefined {
  const [prefix, kind, first = '', ...rest] = catalogId.split(':');
  if (prefix !== 'nip5d') return undefined;
  if (kind === '5129' && HEX_64.test(first)) return first;
  if (kind === '15129' && HEX_64.test(first) && rest.length === 0) return `15129:${first}:`;
  return kind === '35129' && HEX_64.test(first) && rest.length > 0 ? `35129:${first}:${rest.join(':')}` : undefined;
}

function tagRef(tag: readonly string[]): string | undefined {
  const value = tag[1];
  if (typeof value !== 'string') return undefined;
  if (tag[0] === 'a') return NAMED.test(value) || ROOT.test(value) ? value : undefined;
  return tag[0] === 'e' && HEX_64.test(value) ? value : undefined;
}

function intentEntry(tag: readonly string[], archetype: string): readonly [string, string] | undefined {
  const [, convention, ref] = tag;
  if (tag[0] !== 'i' || typeof convention !== 'string' || typeof ref !== 'string') return undefined;
  if (CONVENTION.exec(convention)?.[1] !== archetype) return undefined;
  return catalogIdForRef(ref) ? [convention, ref] : undefined;
}

/**
 * Read the public entries of a handler-preferences event.
 *
 * Unknown tags and malformed entries are ignored without discarding the
 * event. An `i` entry counts only when its convention is queryless,
 * fragment-free and names the event's archetype.
 *
 * @param event - A kind-31129 event, already verified as the user's.
 * @returns The preferences, or undefined when the event is not one.
 * @example
 * ```ts
 * parseHandlerPreferences(event)?.handlers; // ['35129:…:notepad']
 * ```
 */
export function parseHandlerPreferences(event: NostrEvent): HandlerPreferences | undefined {
  const archetype = event.tags.find((tag) => tag[0] === 'd')?.[1];
  if (event.kind !== HANDLER_PREFERENCES_KIND || !archetype) return undefined;
  const handlers: string[] = [];
  const intents: Record<string, string[]> = {};
  for (const tag of event.tags) {
    const ref = tagRef(tag);
    if (ref && !handlers.includes(ref)) handlers.push(ref);
    const entry = intentEntry(tag, archetype);
    if (entry) (intents[entry[0]] ??= []).push(entry[1]);
  }
  return Object.freeze({ archetype, handlers: Object.freeze(handlers), intents: Object.freeze(intents) });
}

/**
 * Catalogue ids the user prefers for one convention: intent-specific entries
 * when any match, otherwise the archetype-wide ones.
 *
 * @param preferences - The user's preferences for the convention's archetype.
 * @param convention - The requested convention identity.
 * @returns Catalogue ids in preference order.
 * @example
 * ```ts
 * preferredHandlers(preferences, 'napplet:profile/edit'); // ['nip5d:35129:…:profile-editor']
 * ```
 */
export function preferredHandlers(preferences: HandlerPreferences | undefined, convention: string): readonly string[] {
  if (!preferences) return [];
  const specific = preferences.intents[convention] ?? [];
  const refs = specific.length > 0 ? specific : preferences.handlers;
  return refs.map(catalogIdForRef).filter((id): id is string => id !== undefined);
}

/**
 * The next version of the user's preferences for an archetype, with one
 * handler moved to the front of the archetype-wide entries.
 *
 * Every other tag and the encrypted private entries are carried over as they
 * were, so the shell never drops a choice it could not read.
 *
 * @param previous - The current event, when there is one.
 * @param archetype - The archetype slug.
 * @param catalogId - The handler the user chose.
 * @param now - Seconds since the epoch.
 * @returns The event to sign, or undefined when the id has no reference form.
 * @example
 * ```ts
 * preferenceTemplate(current, 'profile', candidate.id, Math.floor(Date.now() / 1000));
 * ```
 */
export function preferenceTemplate(previous: NostrEvent | undefined, archetype: string, catalogId: string, now: number): EventTemplate | undefined {
  const ref = refForCatalogId(catalogId);
  if (!ref) return undefined;
  const kept = (previous?.tags ?? []).filter((tag) => tag[0] !== 'd' && tag[1] !== ref);
  const tag = HEX_64.test(ref) ? ['e', ref] : ['a', ref];
  return { kind: HANDLER_PREFERENCES_KIND, created_at: now, content: previous?.content ?? '', tags: [['d', archetype], tag, ...kept] };
}
