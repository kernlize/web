import type { ConsentSummary } from './contract';
import { hostOf } from './servers';

/** Plain words for the short tag names a record carries; anything else is just a label. */
const TAG_NAMES: Readonly<Record<string, string>> = {
  p: 'person',
  e: 'item',
  a: 'address',
  t: 'topic',
  relay: 'relay',
  d: 'name',
  k: 'type',
};

const RELAY_VALUE = /^wss?:\/\//i;

/** Plain names for the record types the shell asks consent for; the number follows in parentheses. */
const KIND_NAMES: Readonly<Record<number, string>> = {
  0: 'profile',
  1: 'post',
  3: 'contacts',
  5: 'deletion',
  62: 'request to erase',
  10002: 'inbox and outbox',
};

/** The plain name of a record type: a known one by name, any other replaceable or list range as such. */
function kindName(kind: number): string {
  const known = KIND_NAMES[kind];
  if (known) return known;
  if (kind >= 30000 && kind < 40000) return 'list';
  return 'record';
}

/** Who signs the record: the active account, or another person by a shortened key. */
function signerText(pubkey: string, accountKey: string | undefined): string {
  if (!pubkey || pubkey === accountKey) return 'your identity';
  return `person ${pubkey.slice(0, 8)}…`;
}

/** What a tag is called: a reference is a relay when it holds a relay's address, a link otherwise. */
function tagName(name: string, first = ''): string {
  if (name === 'r') return RELAY_VALUE.test(first) ? 'relay' : 'link';
  return Object.hasOwn(TAG_NAMES, name) ? (TAG_NAMES[name] as string) : 'label';
}

/** One tag in plain words: its name translated, relay addresses shown by their own host (D-051). */
function tagText([name = '', ...values]: readonly string[]): string {
  return [tagName(name, values[0]), ...values.map((value) => (RELAY_VALUE.test(value) ? hostOf(value) : value))].join(' · ');
}

/** One labelled field of the exact record the shell will sign. */
export interface EventDetail {
  readonly label: string;
  readonly value: string;
}

/**
 * The full record behind a consent prompt, with plain labels instead of wire field names (DECISIONS D-006).
 * Nothing is hidden: every field and every tag value is listed, so a careful reader sees exactly what is signed.
 * Tag names are put in plain words and relay addresses read by their own host.
 * @param event The event attached to the consent summary.
 * @param accountKey The active account's key, so its own records read "your account".
 * @returns Rows in signing order.
 * @example
 * eventDetails(summary.event, session.pubkey).map((row) => `${row.label}: ${row.value}`);
 */
export function eventDetails(event: NonNullable<ConsentSummary['event']>, accountKey?: string): readonly EventDetail[] {
  const rows: EventDetail[] = [
    { label: 'Type', value: `${kindName(event.kind)} (${event.kind})` },
    { label: 'Signed by', value: signerText(event.pubkey, accountKey) },
    { label: 'Created', value: new Date(event.created_at * 1000).toISOString() },
    { label: 'Content', value: event.content || '(empty)' },
  ];
  for (const [index, tag] of event.tags.entries()) rows.push({ label: `Label ${index + 1}`, value: tagText(tag) });
  if (event.id && !/^0+$/.test(event.id)) rows.push({ label: 'Identifier', value: event.id });
  return rows;
}
