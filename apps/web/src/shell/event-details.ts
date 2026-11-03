import type { ConsentSummary } from './contract';
import { serverName } from './servers';
import { namesProtocol } from './vocabulary';

/** Plain words for the short tag names a record carries; anything else is just a label. */
const TAG_NAMES: Readonly<Record<string, string>> = {
  p: 'person',
  e: 'item',
  a: 'address',
  t: 'topic',
  r: 'server',
  relay: 'server',
  d: 'name',
  k: 'type',
};

const SERVER_VALUE = /^wss?:\/\//i;

/** Plain names for the record types the shell asks consent for; the number follows in parentheses. */
const KIND_NAMES: Readonly<Record<number, string>> = {
  0: 'profile',
  1: 'post',
  3: 'contacts',
  5: 'deletion',
  62: 'request to erase',
  10002: 'connections',
};

/** The plain name of a record type: a known one by name, any other replaceable or list range as such. */
function kindName(kind: number): string {
  const known = KIND_NAMES[kind];
  if (known) return known;
  if (kind >= 30000 && kind < 40000) return 'list';
  return 'record';
}

/** How a server address reads in a record: its display name, or just "a server" when that name would name the protocol. */
function serverText(value: string): string {
  const name = serverName(value);
  return namesProtocol(name) ? 'a server' : name;
}

/** Who signs the record: the active account, or another person by a shortened key. */
function signerText(pubkey: string, accountKey: string | undefined): string {
  if (!pubkey || pubkey === accountKey) return 'your account';
  return `person ${pubkey.slice(0, 8)}…`;
}

/** One tag in plain words: its name translated, server addresses shown by their display name. */
function tagText([name = '', ...values]: readonly string[]): string {
  const plain = Object.hasOwn(TAG_NAMES, name) ? (TAG_NAMES[name] as string) : 'label';
  return [plain, ...values.map((value) => (SERVER_VALUE.test(value) ? serverText(value) : value))].join(' · ');
}

/** One labelled field of the exact record the shell will sign. */
export interface EventDetail {
  readonly label: string;
  readonly value: string;
}

/**
 * The full record behind a consent prompt, with plain labels instead of wire field names (DECISIONS D-006).
 * Nothing is hidden: every field and every tag value is listed, so a careful reader sees exactly what is signed.
 * Tag names are put in plain words and server addresses read by their display name.
 * @param event The event attached to the consent summary.
 * @param accountKey The active account's key, so its own records read "your account".
 * @returns Rows in signing order.
 * @example
 * eventDetails(summary.event, session.pubkey).map((row) => `${row.label}: ${row.value}`);
 */
export function eventDetails(event: ConsentSummary['event'], accountKey?: string): readonly EventDetail[] {
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
