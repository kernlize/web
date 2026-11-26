import { verifyEvent } from 'applesauce-core/helpers';
import { parseList } from '@kehto/nip/51';
import type { NostrEvent } from '@napplet/core';
import { NAPPLET_KIND_NAMED, NAPPLET_KIND_ROOT } from '@kehto/nip/5d';
import { catalogIdForRef } from '../intents/preferences.js';

/**
 * The NIP-51 kind AppStore writes a stack as: an app curation set.
 *
 * @example
 * ```ts
 * STACK_KIND; // 30267
 * ```
 */
export const STACK_KIND = 30267;

/**
 * The `d` of the stack a heart button writes; a stack like any other to the shell.
 *
 * @example
 * ```ts
 * DEFAULT_STACK_ID; // 'napplets'
 * ```
 */
export const DEFAULT_STACK_ID = 'napplets';

/**
 * The tag a publisher marks a stack's entry point with: `['start',
 * '35129:<pubkey>:<d>']`, once per applet that should open when the stack is
 * installed. AppStore, Hive and other NIP-51 readers do not know it and ignore
 * it, so a stack carrying it still reads as a plain list everywhere else. A
 * `start` tag that names no member is ignored: the `a` tags alone say what a
 * stack holds, so a marker can never add an applet.
 *
 * @example
 * ```ts
 * event.tags.filter((tag) => tag[0] === STACK_START_TAG); // [['start', '35129:…:toy-rocket']]
 * ```
 */
export const STACK_START_TAG = 'start';

/** One applet a stack holds, from its `a` tag. */
export interface StackMember {
  /** The `a` value: `35129:<pubkey>:<d>` for a named applet, `15129:<pubkey>:` for a root one. */
  readonly ref: string;
  /** The same applet as the intent catalogue names it, for `kernl.decodePointer`. */
  readonly catalogId: string;
  /** The publisher the reference names. */
  readonly pubkey: string;
  /** The manifest's `d`, empty for a root applet. */
  readonly identifier: string;
  readonly eventKind: number;
  /** Relay hints carried as the tag's third element; hints, never identity. */
  readonly relays: readonly string[];
  /** The publisher marked this applet as an entry point: the stack opens it, and installs the rest. */
  readonly start: boolean;
}

/** One stack as the launcher lists it. */
export interface AppletStack {
  /** `<publisher>:<d>`, stable across versions of the stack. */
  readonly id: string;
  /** The `d` the publisher chose; {@link DEFAULT_STACK_ID} for the recommended one. */
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly publisher: string;
  /** The applets in the stack, in the order the publisher listed them. */
  readonly members: readonly StackMember[];
  readonly publishedAt: number;
}

const MEMBER_KINDS = new Set([NAPPLET_KIND_NAMED, NAPPLET_KIND_ROOT]);

function textTag(event: NostrEvent, name: string): string | undefined {
  const value = event.tags.find((tag) => tag[0] === name)?.[1];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function memberOf(tag: readonly string[], starts: ReadonlySet<string>): StackMember | undefined {
  const ref = tag[1];
  if (ref === undefined) return undefined;
  const [kindText = '', pubkey = '', ...rest] = ref.split(':');
  const eventKind = Number(kindText);
  if (!MEMBER_KINDS.has(eventKind) || pubkey === '') return undefined;
  const identifier = rest.join(':');
  const catalogId = catalogIdForRef(ref);
  if (!catalogId) return undefined;
  const hint = tag[2]?.trim();
  return Object.freeze({ ref, catalogId, pubkey, identifier, eventKind, relays: Object.freeze(hint ? [hint] : []), start: starts.has(ref) });
}

function startsOf(event: NostrEvent): ReadonlySet<string> {
  const starts = new Set<string>();
  for (const tag of event.tags) {
    const ref = tag[1];
    if (tag[0] === STACK_START_TAG && typeof ref === 'string' && ref !== '') starts.add(ref);
  }
  return starts;
}

function membersOf(event: NostrEvent): readonly StackMember[] {
  const starts = startsOf(event);
  const members = new Map<string, StackMember>();
  for (const tag of event.tags) {
    if (tag[0] !== 'a') continue;
    const member = memberOf(tag, starts);
    if (member && !members.has(member.catalogId)) members.set(member.catalogId, member);
  }
  return Object.freeze([...members.values()]);
}

/**
 * Read a stack from a NIP-51 app curation set (kind 30267).
 *
 * The `a` tags are read as napplet manifest coordinates; a tag that names
 * anything else — a zapstore app, another set — is not a member. A {@link
 * STACK_START_TAG} naming one of them marks it as an entry point, and one
 * naming anything else is ignored. Title falls
 * back the way AppStore's does, `title`, then `name`, then the `d`; an event
 * without a `d` is not a set and yields nothing. The signature binds the list to the
 * publisher shown in the launcher; its applets are independently verified at resolution.
 *
 * @param event - A candidate stack event.
 * @returns The stack, or undefined when the event is not an app curation set.
 * @example
 * ```ts
 * const stack = toAppletStack(event);
 * stack?.members.map((member) => member.catalogId); // ['nip5d:35129:…:notes']
 * ```
 */
export function toAppletStack(event: NostrEvent): AppletStack | undefined {
  if (event.kind !== STACK_KIND || !verifyEvent(event)) return undefined;
  const list = parseList(event);
  if (list.identifier === '') return undefined;
  return Object.freeze({
    id: `${event.pubkey}:${list.identifier}`,
    identifier: list.identifier,
    title: list.title?.trim() || textTag(event, 'name') || list.identifier,
    description: list.description?.trim() ?? '',
    publisher: event.pubkey,
    members: membersOf(event),
    publishedAt: event.created_at,
  });
}

/**
 * Keep the newest version of each stack, newest first.
 *
 * Sets are addressable, so relays hold every version; the shell lists one. A
 * stack republished with no applets in it is how AppStore deletes one — napplet
 * shells refuse NIP-09 deletions — so an empty set is not listed.
 *
 * @param stacks - Stacks in any order, possibly repeated or superseded.
 * @returns One stack per `(publisher, d)`, those with members only.
 * @example
 * ```ts
 * newestStacks([olderMesh, newerMesh]); // [newerMesh]
 * ```
 */
export function newestStacks(stacks: readonly AppletStack[]): readonly AppletStack[] {
  const newest = new Map<string, AppletStack>();
  for (const stack of stacks) {
    const current = newest.get(stack.id);
    if (!current || stack.publishedAt > current.publishedAt) newest.set(stack.id, stack);
  }
  return Object.freeze([...newest.values()].filter((stack) => stack.members.length > 0).sort((a, b) => b.publishedAt - a.publishedAt));
}
