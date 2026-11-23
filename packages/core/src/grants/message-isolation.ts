import type { Capability } from '@kehto/runtime';
import { BASELINE_DOMAINS, capabilitiesForDomains } from './domain-capabilities.js';

/**
 * The domain that lets an applet read and write the person's private messages.
 *
 * @example
 * ```ts
 * grants.get(identity)?.domains.includes(MESSAGES_DOMAIN); // the applet is sealed
 * ```
 */
export const MESSAGES_DOMAIN = 'dm';

/**
 * Every domain an applet may hold together with messages. None of them can
 * carry what the applet read to anywhere but the person's own screen and
 * this device: the handshake, messages themselves, which identity is signed
 * in, the theme, the applet's own storage and settings, notifications,
 * keyboard shortcuts, and being handed a request by another applet.
 *
 * It is an allowlist, so a domain kehto adds later is withheld until it is
 * put here on purpose (D-046).
 *
 * @example
 * ```ts
 * MESSAGE_COMPANION_DOMAINS.includes('upload'); // false
 * ```
 */
export const MESSAGE_COMPANION_DOMAINS: readonly string[] = Object.freeze(['shell', MESSAGES_DOMAIN, 'identity', 'theme', 'storage', 'config', 'notify', 'keys', 'intent']);

/**
 * Capabilities withheld even inside a companion domain: an applet that reads
 * messages may be handed a request by another applet, never hand one on.
 */
const WITHHELD_CAPABILITIES: readonly Capability[] = Object.freeze(['intent:write']);

/**
 * Whether an applet's grants seal it: it holds messages, so it holds nothing
 * that could send them on.
 *
 * @param granted - The domains the person allowed.
 * @returns True when messages are among them.
 * @example
 * ```ts
 * sealsApplet(['dm', 'relay']); // true
 * ```
 */
export function sealsApplet(granted: readonly string[]): boolean {
  return granted.includes(MESSAGES_DOMAIN);
}

/**
 * The domains actually in force for an applet: the baseline plus what the
 * person allowed, cut down to {@link MESSAGE_COMPANION_DOMAINS} when the
 * applet holds messages. A domain the person chose to keep beside messages
 * stays (D-060): `kept` is theirs alone, never an applet's, and frees one
 * domain at a time.
 *
 * @param granted - The domains the person allowed.
 * @param baseline - Domains every applet holds; {@link BASELINE_DOMAINS} by default.
 * @param kept - Domains the person chose to keep beside messages.
 * @returns The domains in force, baseline first.
 * @example
 * ```ts
 * domainsInForce(['relay']); // ['shell', 'inc', 'theme', 'storage', 'keys', 'relay']
 * domainsInForce(['dm', 'relay', 'upload']); // ['shell', 'theme', 'storage', 'keys', 'dm']
 * domainsInForce(['dm', 'relay', 'upload'], undefined, ['upload']); // [..., 'dm', 'upload']
 * ```
 */
export function domainsInForce(granted: readonly string[], baseline: readonly string[] = BASELINE_DOMAINS, kept: readonly string[] = []): readonly string[] {
  const held = [...new Set([...baseline, ...granted])];
  return Object.freeze(sealsApplet(granted) ? held.filter((domain) => MESSAGE_COMPANION_DOMAINS.includes(domain) || kept.includes(domain)) : held);
}

/**
 * The domains an applet would hold but for messages: allowed by the person
 * or part of the baseline, and not in force while it can read messages.
 *
 * @param granted - The domains the person allowed.
 * @param baseline - Domains every applet holds; {@link BASELINE_DOMAINS} by default.
 * @param kept - Domains the person chose to keep beside messages.
 * @returns The withheld domains; empty for an applet without messages.
 * @example
 * ```ts
 * withheldDomains(['dm', 'relay']); // ['inc', 'relay']
 * withheldDomains(['dm', 'relay'], undefined, ['relay']); // ['inc']
 * ```
 */
export function withheldDomains(granted: readonly string[], baseline: readonly string[] = BASELINE_DOMAINS, kept: readonly string[] = []): readonly string[] {
  const inForce = domainsInForce(granted, baseline, kept);
  return Object.freeze([...new Set([...baseline, ...granted])].filter((domain) => !inForce.includes(domain)));
}

/**
 * The kehto capabilities an applet's grants come to, after the seal.
 *
 * @param granted - The domains the person allowed.
 * @param kept - Domains the person chose to keep beside messages.
 * @param baseline - Domains every applet holds; {@link BASELINE_DOMAINS} by default.
 * @returns The capabilities to write into the runtime ACL.
 * @example
 * ```ts
 * capabilitiesInForce(['dm', 'intent', 'relay']); // dm, baseline and 'intent:read'; no relay, no 'intent:write'
 * ```
 */
export function capabilitiesInForce(granted: readonly string[], kept: readonly string[] = [], baseline: readonly string[] = BASELINE_DOMAINS): readonly Capability[] {
  const capabilities = capabilitiesForDomains(domainsInForce(granted, baseline, kept));
  return sealsApplet(granted) ? capabilities.filter((capability) => !WITHHELD_CAPABILITIES.includes(capability)) : capabilities;
}
