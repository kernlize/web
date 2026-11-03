import type { Bridge } from './types';

/** One row of a user-facing description. */
export interface DescriptionRow {
  readonly label: string;
  readonly value: string;
}

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
    ? [{ label: 'Status', value: 'ready' }]
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
