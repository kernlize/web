import { describeBridge, type Bridge, type DescriptionRow } from '@kernl/bridges';

/**
 * Bridges share functional labels (three say "downloads"), so the settings list names each by
 * what it does for the person. Keyed by bridge id; no wire format appears in a name (D-006).
 */
const NAMES: Readonly<Record<string, string>> = {
  http: 'Downloads (web)',
  torrent: 'Downloads (from peers)',
  nzb: 'Downloads (archives)',
  soulseek: 'Sharing',
  mail: 'Mail',
};

const REASONS: Readonly<Record<string, string>> = {
  'no-backend': 'Needs a backend',
};

/** The bridge's display name: the mapped name, else its label with a capital. */
export function bridgeName(bridge: Pick<Bridge, 'id' | 'label'>): string {
  return NAMES[bridge.id] ?? `${bridge.label.charAt(0).toUpperCase()}${bridge.label.slice(1)}`;
}

/** describeBridge's rows in words: the name replaces "Used for", and availability reads as a sentence. */
export function bridgeRows(bridge: Bridge): readonly DescriptionRow[] {
  const rows = describeBridge(bridge).filter((row) => row.label !== 'Used for' && row.label !== 'Reason');
  const availability = bridge.availability();
  const status = availability.available ? 'Ready' : (REASONS[availability.reason] ?? 'Not available');
  return rows.map((row) => (row.label === 'Status' ? { label: 'Availability', value: status } : row));
}
