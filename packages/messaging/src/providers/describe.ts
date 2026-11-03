import type { MessagingProvider } from '../types.js';

/** One row of a provider's security description. */
export interface ProviderDescriptionRow {
  readonly label: string;
  readonly value: string;
}

const yesNo = (flag: boolean): string => (flag ? 'yes' : 'no');

/**
 * Render a provider's security properties as user-facing rows for the picker.
 * The rows state facts and never rank; the `specification` field is left out
 * because protocol names stay out of the UI (D-006, D-009).
 *
 * @param provider - The provider to describe.
 * @returns Label/value pairs in a fixed order.
 * @example
 * ```ts
 * describeProvider(privateProvider)[0];
 * // { label: 'Forward secrecy', value: 'no' }
 * ```
 */
export function describeProvider(provider: MessagingProvider): readonly ProviderDescriptionRow[] {
  const p = provider.properties;
  return [
    { label: 'Forward secrecy', value: yesNo(p.forwardSecrecy) },
    { label: 'Recovers after a key compromise', value: yesNo(p.postCompromiseSecurity) },
    { label: 'Metadata protection', value: p.metadataProtection },
    { label: 'Correspondent needs the same app', value: yesNo(p.requiresSameClient) },
    { label: 'Group conversations', value: yesNo(p.groups) },
    { label: 'Experimental', value: yesNo(p.experimental) },
  ];
}
