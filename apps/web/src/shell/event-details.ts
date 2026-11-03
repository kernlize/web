import type { ConsentSummary } from './contract';
import { serverName } from './servers';

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

/** One tag in plain words: its name translated, server addresses shown by their display name. */
function tagText([name = '', ...values]: readonly string[]): string {
  const plain = Object.hasOwn(TAG_NAMES, name) ? (TAG_NAMES[name] as string) : 'label';
  return [plain, ...values.map((value) => (SERVER_VALUE.test(value) ? serverName(value) : value))].join(' · ');
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
 * @returns Rows in signing order.
 * @example
 * eventDetails(summary.event).map((row) => `${row.label}: ${row.value}`);
 */
export function eventDetails(event: ConsentSummary['event']): readonly EventDetail[] {
  const rows: EventDetail[] = [
    { label: 'Type', value: String(event.kind) },
    { label: 'Signed by', value: event.pubkey || '(your account, at signing)' },
    { label: 'Created', value: new Date(event.created_at * 1000).toISOString() },
    { label: 'Content', value: event.content || '(empty)' },
  ];
  for (const [index, tag] of event.tags.entries()) rows.push({ label: `Label ${index + 1}`, value: tagText(tag) });
  if (event.id && !/^0+$/.test(event.id)) rows.push({ label: 'Identifier', value: event.id });
  return rows;
}
