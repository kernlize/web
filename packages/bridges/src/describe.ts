import type { Bridge } from './types';

/** One row of a user-facing description. */
export interface DescriptionRow {
  readonly label: string;
  readonly value: string;
}

/**
 * A hand-off bridge opens an app on the user's device; kernl connects to nothing for it.
 * The exposure rows that follow still hold, because that app speaks the same protocol.
 */
const HANDOFF_ROWS: readonly DescriptionRow[] = [
  { label: 'Handled by', value: 'an app on your device' },
  { label: 'Sent through kernl', value: 'no' },
];

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

/**
 * Describes a bridge for the user in plain rows: what it does, whether it is ready,
 * and what the other side learns. Labels never name a protocol.
 *
 * @param bridge - The bridge to describe.
 * @returns Rows in display order.
 * @example
 * ```ts
 * describeBridge(createHttpBridge());
 * // [{ label: 'Used for', value: 'downloads' }, { label: 'Status', value: 'ready' }, ...]
 * ```
 */
export function describeBridge(bridge: Bridge): readonly DescriptionRow[] {
  const availability = bridge.availability();
  const status: DescriptionRow[] = availability.available
    ? [{ label: 'Status', value: 'ready' }, ...(availability.handoff ? HANDOFF_ROWS : [])]
    : [
        { label: 'Status', value: 'not available' },
        { label: 'Reason', value: availability.reason },
      ];
  return [
    { label: 'Used for', value: bridge.label },
    ...status,
    { label: 'Shares your network address', value: yesNo(bridge.exposure.revealsAddress) },
    { label: 'Encrypted in transit', value: yesNo(bridge.exposure.encryptedInTransit) },
    { label: 'Activity visible to others', value: yesNo(bridge.exposure.publicActivity) },
  ];
}
