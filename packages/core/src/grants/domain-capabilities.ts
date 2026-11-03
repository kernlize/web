import type { Capability } from '@kehto/runtime';

/**
 * Which kehto capabilities a NAP domain needs, following `resolveCapabilitiesNap`.
 * `shell` and `inc` map to nothing: the handshake needs no grant and `inc`
 * reuses the relay capabilities of the messages it carries.
 */
export const DOMAIN_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = Object.freeze({
  shell: [],
  inc: [],
  relay: ['relay:read', 'relay:write'],
  identity: ['identity:read'],
  storage: ['state:read', 'state:write'],
  theme: ['theme:read'],
  keys: ['keys:bind', 'keys:forward'],
  media: ['media:control'],
  notify: ['notify:send', 'notify:channel'],
  config: ['config:read'],
  resource: ['resource:fetch'],
  cvm: ['cvm:call'],
  outbox: ['outbox:read', 'outbox:write'],
  upload: ['upload:write'],
  intent: ['intent:read', 'intent:write'],
  dm: ['dm:read', 'dm:write'],
  fs: ['fs:read', 'fs:write'],
  llm: ['llm:generate'],
  cache: ['cache:read', 'cache:write'],
});

/**
 * Domains every applet gets without asking: the handshake, in-shell messaging,
 * the theme and scoped storage. No network, and not the identity: which
 * account is signed in is the user's to reveal, so an applet learns it only
 * after the user grants "your account" (SOUL opinion 2).
 */
export const BASELINE_DOMAINS: readonly string[] = Object.freeze(['shell', 'inc', 'theme', 'storage']);

/**
 * Capabilities a domain needs. Unknown domains need none, which keeps the
 * grants layer honest about domains kehto adds later: they are advertised only
 * when the environment resolver allows them.
 *
 * @param domain - Bare NAP domain name.
 * @returns The capabilities, possibly empty.
 * @example
 * ```ts
 * capabilitiesForDomain('relay'); // ['relay:read', 'relay:write']
 * ```
 */
export function capabilitiesForDomain(domain: string): readonly Capability[] {
  return DOMAIN_CAPABILITIES[domain] ?? [];
}

/**
 * The union of capabilities a set of domains needs, deduplicated.
 *
 * @param domains - Bare NAP domain names.
 * @returns The capabilities in table order.
 * @example
 * ```ts
 * capabilitiesForDomains(['identity', 'storage']); // ['identity:read', 'state:read', 'state:write']
 * ```
 */
export function capabilitiesForDomains(domains: readonly string[]): readonly Capability[] {
  const wanted = new Set(domains);
  const result: Capability[] = [];
  for (const [domain, capabilities] of Object.entries(DOMAIN_CAPABILITIES)) {
    if (wanted.has(domain)) result.push(...capabilities);
  }
  return result;
}
