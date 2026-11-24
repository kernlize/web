/**
 * The message seal on its own: which domains may go with messages, and what an applet that reads
 * them is left with (D-046, D-060). A view model or a host UI that needs only these loads them
 * without the network stack, as `wm`, `crypto` and `cache` are loaded (D-022).
 *
 * @packageDocumentation
 */
export { MESSAGES_DOMAIN, MESSAGE_COMPANION_DOMAINS, capabilitiesInForce, domainsInForce, sealsApplet, withheldDomains } from '../grants/message-isolation.js';
export { BASELINE_DOMAINS, DOMAIN_CAPABILITIES, capabilitiesForDomain, capabilitiesForDomains } from '../grants/domain-capabilities.js';
