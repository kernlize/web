import type { FirewallStateContainer } from '@kehto/runtime';
import type { NappletRules, RateLimit } from '@kehto/firewall';
import { applyNappletRules, type GuardConfig, type OpClass } from '@kernl/guard';

/**
 * How the guard's operation classes appear inside kehto's runtime firewall.
 *
 * The runtime keys its observations by the sender capability a message needs
 * (`relay:write`, `resource:fetch`), while the guard classifies by what the
 * message does (`relay:publish`, `resource:bytes`). `null` means the class has
 * no runtime counterpart: deletions share `relay:write` with other publishes,
 * `control` envelopes need no capability, and `generic` becomes the per-applet
 * global rate.
 */
export const RUNTIME_OP_CLASSES: Readonly<Record<OpClass, string | null>> = Object.freeze({
  'relay:subscribe': 'relay:read',
  'relay:publish': 'relay:write',
  'relay:publish:delete': null,
  'outbox:subscribe': 'outbox:read',
  'outbox:publish': 'outbox:write',
  'resource:bytes': 'resource:fetch',
  'storage:write': 'state:write',
  'dm:send': 'dm:write',
  'intent:invoke': 'intent:write',
  control: null,
  generic: null,
});

/** One rate limit in the runtime's vocabulary. */
export interface RuntimeRateRule {
  readonly opClass: string;
  readonly limit: RateLimit;
}

/** The rules {@link applyRuntimeFirewallRules} installs for one applet. */
export interface RuntimeFirewallRules {
  readonly rates: readonly RuntimeRateRule[];
  readonly globalRate: RateLimit;
}

/**
 * Translate the guard profile's per-class rates for one applet into the
 * runtime firewall's `(napplet, opClass)` rate limits.
 *
 * @param config - Current guard configuration.
 * @param napplet - Applet identity (dTag).
 * @returns Runtime rate rules and the global fallback rate.
 * @example
 * ```ts
 * runtimeFirewallRules(createGuardConfig('strict'), 'chat').rates.find((r) => r.opClass === 'relay:write');
 * ```
 */
export function runtimeFirewallRules(config: GuardConfig, napplet: string): RuntimeFirewallRules {
  // applyNappletRules always registers the applet, so the entry exists.
  const rules = applyNappletRules(config, napplet).firewall.napplets[napplet] as NappletRules;
  const rates: RuntimeRateRule[] = [];
  for (const [opClass, limit] of Object.entries(rules.rateLimits)) {
    const runtimeClass = RUNTIME_OP_CLASSES[opClass as OpClass];
    if (runtimeClass) rates.push({ opClass: runtimeClass, limit });
  }
  return { rates, globalRate: rules.globalRate as RateLimit };
}

/**
 * Install the guard profile's rates for an applet in the runtime firewall.
 *
 * This is the pre-dispatch half of kernl's guard: `ShellAdapter` does not
 * forward kehto's firewall hooks (D-001), but the runtime's own firewall still
 * runs before every dispatch, so the profile's limits are pushed into it when
 * a window binds. The policy is `allow`; the user's choices to deny or block
 * live in the grants layer, not here.
 *
 * @param firewallState - `bridge.runtime.firewallState`.
 * @param config - Current guard configuration.
 * @param napplet - Applet identity (dTag).
 * @returns Nothing; the firewall state is mutated and persisted.
 * @example
 * ```ts
 * applyRuntimeFirewallRules(bridge.runtime.firewallState, guardConfig, summary.identity.dTag);
 * ```
 */
export function applyRuntimeFirewallRules(
  firewallState: Pick<FirewallStateContainer, 'setRateLimit' | 'setGlobalRate' | 'setPolicy' | 'persist'>,
  config: GuardConfig,
  napplet: string,
): void {
  const rules = runtimeFirewallRules(config, napplet);
  for (const rule of rules.rates) firewallState.setRateLimit(napplet, rule.opClass, rule.limit);
  firewallState.setGlobalRate(napplet, rules.globalRate);
  firewallState.setPolicy(napplet, 'allow');
  firewallState.persist();
}
