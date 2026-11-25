import { SECRET_SETTINGS } from './actions.js';

/**
 * Every result line the page writes, from what the SDK returned. Pure, and in
 * the shell's vocabulary: no protocol names, never "account".
 */
const LABELS: Readonly<Record<string, string>> = {
  relay: 'network',
  outbox: 'posting to your network',
  identity: 'your identity',
  storage: 'its own storage',
  config: 'its settings',
  resource: 'web fetches',
  link: 'opening links',
  notify: 'notifications',
  media: 'media controls',
  intent: 'opening other applets',
  torrent: 'peer sharing',
};

/** Plain words for a domain; never its wire name. */
export const domainWords = (domain: string): string => LABELS[domain] ?? 'another capability';

export const notGranted = (domain: string): string => `Refused: this applet has no grant for ${domainWords(domain)}.`;

/** The granted line under the note field. */
export function grantedLine(domains: readonly string[]): string {
  const words = [...new Set(domains.map(domainWords))];
  return `Granted: ${words.length ? words.join(', ') : 'nothing beyond the baseline'}.`;
}

/**
 * Whether the person said no at the prompt: the shell's `denied:consent`, or a
 * decline. Any other failure (`publish denied`, `policy denied`, a relay
 * error) is shown as the reason the SDK returned, never as their refusal.
 */
const refused = (reason: string): boolean => reason === 'denied:consent' || /declined/i.test(reason);

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const publishDone = (name: string): string => `${name}: done.`;

export function publishFailed(name: string, error: unknown): string {
  const reason = reasonOf(error);
  return refused(reason) ? `${name}: you said no.` : `${name}: not sent (${reason}).`;
}

export const NOTIFIED = 'Notification shown.';

export const notifyFailed = (error: unknown): string => `No notification (${reasonOf(error)}).`;

/** What the applet now holds, in words; a secret is only said to be set. */
export function describeValues(values: Readonly<Record<string, unknown>>): string {
  const parts = Object.entries(values).map(([key, value]) => (SECRET_SETTINGS.has(key) ? `${key} set` : `${key} ${JSON.stringify(value)}`));
  return parts.length ? `Its settings: ${parts.join(', ')}.` : 'Its settings: none yet.';
}

export const settingsFailed = (error: unknown): string => `Its settings could not be shown (${reasonOf(error)}).`;

/** An intent answer; `taker` is the handling applet's title when the shell lists it. */
export function intentWords(result: { readonly ok: boolean; readonly error?: string }, taker: string | undefined): string {
  if (!result.ok) return `Nobody took it (${result.error ?? 'no reason given'}).`;
  return `${taker ?? 'Another applet'} is taking it.`;
}

/** A request another applet handed to this one. */
export function deliveryWords(delivery: { readonly action: string; readonly archetype: string; readonly payload?: unknown }): string {
  const pubkey = (delivery.payload as { pubkey?: unknown } | undefined)?.pubkey;
  const whose = typeof pubkey === 'string' && /^[0-9a-f]{64}$/.test(pubkey) ? ` for ${pubkey.slice(0, 8)}…` : '';
  return `Another applet asked this applet to ${delivery.action} a ${delivery.archetype}${whose}.`;
}

export const floodSent = (count: number): string => `Sent ${count} network reads at once.`;

export const floodAnswered = (answered: number, count: number): string =>
  answered === count ? `All ${count} reads were answered.` : `${answered} of ${count} reads were answered; the guard held back the rest.`;

export function downloadWords(result: { readonly ok: boolean }): string {
  return result.ok ? 'Added to your downloads.' : 'The download could not be handed off.';
}

export const downloadFailed = (): string => 'The download could not be handed off.';

export function linkWords(result: { readonly status: string }): string {
  return result.status === 'opened' ? 'The link was opened.' : 'You did not open the link.';
}

export const linkFailed = (error: unknown): string => `The link was not opened (${reasonOf(error)}).`;
