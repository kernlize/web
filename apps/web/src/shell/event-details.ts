import type { ConsentSummary } from './contract';

/** One labelled field of the exact record the shell will sign. */
export interface EventDetail {
  readonly label: string;
  readonly value: string;
}

/**
 * The full record behind a consent prompt, with plain labels instead of wire field names (DECISIONS D-006).
 * Nothing is hidden: every field and every tag is listed, verbatim, so a careful reader sees exactly what is signed.
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
  for (const [index, tag] of event.tags.entries()) rows.push({ label: `Label ${index + 1}`, value: tag.join(' · ') });
  if (event.id && !/^0+$/.test(event.id)) rows.push({ label: 'Identifier', value: event.id });
  return rows;
}
