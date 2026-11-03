import { isReplaceable } from 'applesauce-core/helpers';
import type { NostrEvent } from '@napplet/core';
import type { AppletIdentity, ConsentLine, ConsentSummary } from '../types.js';

const PROFILE_FIELDS: readonly (readonly [key: string, label: string])[] = [
  ['name', 'Name'],
  ['display_name', 'Display name'],
  ['about', 'About'],
  ['picture', 'Picture'],
  ['banner', 'Banner'],
  ['nip05', 'Verified address'],
  ['lud16', 'Payment address'],
  ['website', 'Website'],
];

const KIND_LABELS: Readonly<Record<number, string>> = {
  1: 'note',
  4: 'legacy private message',
  6: 'repost',
  7: 'reaction',
  1059: 'sealed message',
  1111: 'comment',
  9735: 'payment receipt',
  30023: 'article',
};

/** Content preview length for routine publishes. */
const PREVIEW_LENGTH = 140;
/** Hex prefix shown for ids and keys. */
const PREFIX_LENGTH = 8;
/** How many ids a line names before counting the rest. */
const NAMED_ITEMS = 3;

/**
 * Shorten a hex id or key to a recognisable prefix.
 *
 * @param hex - A 64-hex id or public key.
 * @returns The first eight characters and an ellipsis.
 * @example
 * ```ts
 * abbreviate('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'); // '3bf0c63f…'
 * ```
 */
export function abbreviate(hex: string): string {
  return `${hex.slice(0, PREFIX_LENGTH)}…`;
}

function tagValues(event: NostrEvent | undefined, name: string): string[] {
  return (event?.tags ?? []).filter((tag) => tag[0] === name && typeof tag[1] === 'string').map((tag) => tag[1] as string);
}

function listItems(event: NostrEvent | undefined): string[] {
  return (event?.tags ?? [])
    .filter((tag) => tag[0] !== 'd' && tag[0] !== 'title' && tag[0] !== 'description' && typeof tag[1] === 'string')
    .map((tag) => `${tag[0]}:${tag[1]}`);
}

function diff(before: readonly string[], after: readonly string[]): { added: string[]; removed: string[] } {
  const was = new Set(before);
  const now = new Set(after);
  return { added: after.filter((item) => !was.has(item)), removed: before.filter((item) => !now.has(item)) };
}

function describeItems(items: readonly string[], render: (item: string) => string): string {
  const named = items.slice(0, NAMED_ITEMS).map(render).join(', ');
  const rest = items.length - NAMED_ITEMS;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

function changeLines(before: readonly string[], after: readonly string[], noun: string, render: (item: string) => string): ConsentLine[] {
  const { added, removed } = diff(before, after);
  const lines: ConsentLine[] = [];
  if (added.length > 0) lines.push({ label: `${noun} added`, after: `${added.length}: ${describeItems(added, render)}` });
  if (removed.length > 0) lines.push({ label: `${noun} removed`, before: `${removed.length}: ${describeItems(removed, render)}` });
  if (lines.length === 0) lines.push({ label: 'Change', after: 'No entries change' });
  return lines;
}

function parseProfile(event: NostrEvent | undefined): Record<string, unknown> {
  if (!event) return {};
  try {
    const parsed: unknown = JSON.parse(event.content);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function profileLines(event: NostrEvent, before: NostrEvent | undefined): ConsentLine[] {
  const was = parseProfile(before);
  const now = parseProfile(event);
  const lines: ConsentLine[] = [];
  for (const [key, label] of PROFILE_FIELDS) {
    const previous = text(was[key]);
    const next = text(now[key]);
    if (previous === next) continue;
    const line: { label: string; before?: string; after?: string } = { label };
    if (previous !== undefined) line.before = previous;
    if (next !== undefined) line.after = next;
    lines.push(line);
  }
  if (lines.length === 0) lines.push({ label: 'Change', after: 'No profile fields change' });
  return lines;
}

function relayEntries(event: NostrEvent | undefined): string[] {
  return (event?.tags ?? [])
    .filter((tag) => tag[0] === 'r' && typeof tag[1] === 'string')
    .map((tag) => (tag[2] ? `${tag[1]} (${tag[2]})` : (tag[1] as string)));
}

function isListKind(kind: number): boolean {
  return (kind >= 10000 && kind <= 10099) || (kind >= 30000 && kind <= 30099);
}

/** Deletion request: erases the events and addresses it names. */
const DELETION = 5;
/** Request to vanish: asks services to erase everything the account published. */
const VANISH = 62;
/** The `relay` tag value a request to vanish uses to address every service. */
const ALL_SERVICES = 'ALL_RELAYS';

/**
 * Whether {@link describeChange} rates a kind `destructive`: every replaceable
 * and addressable kind (signing one overwrites the version before it),
 * deletions, and requests to vanish.
 *
 * @param kind - The kind of the event about to be signed.
 * @returns True when signing it replaces or erases part of the account's public record.
 * @example
 * ```ts
 * isDestructiveKind(0); // true
 * isDestructiveKind(30311); // true
 * isDestructiveKind(1); // false
 * ```
 */
export function isDestructiveKind(kind: number): boolean {
  return isReplaceable(kind) || kind === DELETION || kind === VANISH;
}

function nameOf(event: NostrEvent): string | undefined {
  return tagValues(event, 'title')[0] ?? tagValues(event, 'd')[0];
}

function listTitle(event: NostrEvent): string {
  const name = nameOf(event);
  return name ? `Change the list "${name}"` : 'Change a list';
}

function replaceTitle(event: NostrEvent): string {
  const name = nameOf(event);
  const label = `Replace your ${kindLabel(event.kind)}`;
  return name ? `${label} "${name}"` : label;
}

function recordLines(event: NostrEvent, before: NostrEvent | undefined): ConsentLine[] {
  const lines = changeLines(listItems(before), listItems(event), 'Entries', (item) => item);
  if (before !== undefined && before.content !== event.content) lines.push({ label: 'Content', after: 'Replaced' });
  return lines;
}

function coordinate(address: string): string {
  const [kind, pubkey = '', identifier = ''] = address.split(':');
  return `${kind}:${abbreviate(pubkey)}:${identifier}`;
}

function deletion(event: NostrEvent, applet: AppletIdentity): ConsentSummary {
  const lines: ConsentLine[] = [
    ...tagValues(event, 'e').map((id) => ({ label: 'Delete', before: abbreviate(id) })),
    ...tagValues(event, 'a').map((address) => ({ label: 'Delete every version of', before: coordinate(address) })),
  ];
  const noun = lines.length === 1 ? 'event' : 'events';
  return destructive(event, applet, `Delete ${lines.length} ${noun}`, lines);
}

function vanish(event: NostrEvent, applet: AppletIdentity): ConsentSummary {
  const services = tagValues(event, 'relay');
  const everywhere = services.length === 0 || services.includes(ALL_SERVICES);
  const lines: ConsentLine[] = [{ label: 'Erase', before: 'Everything this account has published' }];
  lines.push({ label: 'Services asked', after: everywhere ? 'Every service' : describeItems(services, (item) => item) });
  return destructive(event, applet, 'Ask services to erase your account', lines);
}

function kindLabel(kind: number): string {
  return KIND_LABELS[kind] ?? `kind ${kind} event`;
}

function preview(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
}

function destructive(event: NostrEvent, applet: AppletIdentity, title: string, lines: ConsentLine[]): ConsentSummary {
  return { title, severity: 'destructive', lines, applet, event };
}

/**
 * Describe a write the shell is asked to sign as what it changes.
 *
 * Profiles diff field by field; follow, relay and list changes count what was
 * added and removed and name the first few entries by hex prefix; any other
 * replaceable or addressable record diffs its tags and says when its content
 * is replaced, without copying it; deletions list the events and addresses
 * that disappear; a request to vanish names the services asked. Those kinds
 * are `destructive` because they replace or erase the account's public record. Everything else is `routine` and shows
 * a content preview. Nothing here is protocol vocabulary the user has to know,
 * and nothing secret is copied out of the event.
 *
 * @param event - The event to be signed.
 * @param before - The current version of the replaceable event, when known.
 * @param applet - The applet asking.
 * @returns The summary the host renders.
 * @example
 * ```ts
 * describeChange(kind3Event, currentFollows, identity).lines[0];
 * // { label: 'Follows added', after: '1: 3bf0c63f…' }
 * ```
 */
export function describeChange(event: NostrEvent, before: NostrEvent | undefined, applet: AppletIdentity): ConsentSummary {
  switch (event.kind) {
    case 0:
      return destructive(event, applet, 'Update your profile', profileLines(event, before));
    case 3:
      return destructive(event, applet, 'Change who you follow', changeLines(tagValues(before, 'p'), tagValues(event, 'p'), 'Follows', abbreviate));
    case DELETION:
      return deletion(event, applet);
    case VANISH:
      return vanish(event, applet);
    case 10002:
      return destructive(event, applet, 'Change your connections list', changeLines(relayEntries(before), relayEntries(event), 'Connections', (item) => item));
    default:
      if (isListKind(event.kind)) {
        return destructive(event, applet, listTitle(event), changeLines(listItems(before), listItems(event), 'Entries', (item) => item));
      }
      if (isReplaceable(event.kind)) return destructive(event, applet, replaceTitle(event), recordLines(event, before));
      return {
        title: `Publish a ${kindLabel(event.kind)}`,
        severity: 'routine',
        lines: [{ label: 'Content', after: preview(event.content) }],
        applet,
        event,
      };
  }
}
