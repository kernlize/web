import type { FirewallEvent, FirewallPersistence, FirewallStateContainer } from '@kehto/runtime';
import type { NappletRules, RateLimit } from '@kehto/firewall';
import { applyNappletRules, type GuardConfig, type GuardEvent, type OpClass } from '@kernl/guard';
import type { StorageLike } from '../types.js';

/*
 * Every call kernl makes into the runtime firewall's own configuration lives in
 * this module. kehto/web#336 replaces these seams on hosts that configure
 * permissions (`permissions.setRateLimit`, `onRateLimit`), so moving there is a
 * change to this file only (D-020).
 */

/**
 * Where kernl stores the runtime firewall's configuration in the host storage.
 *
 * @example
 * ```ts
 * localStorage.getItem(RUNTIME_FIREWALL_STORAGE_KEY); // the serialised kehto firewall config
 * ```
 */
export const RUNTIME_FIREWALL_STORAGE_KEY = 'kernl:firewall:v1';

/**
 * How the guard's operation classes appear inside kehto's runtime firewall.
 *
 * The runtime keys its observations by the sender capability a message needs
 * (`relay:write`, `resource:fetch`), while the guard classifies by what the
 * message does (`relay:publish`, `resource:bytes`). `null` means the class has
 * no runtime counterpart: deletions share `relay:write` with other publishes,
 * `control` envelopes need no capability, and `generic` becomes the per-applet
 * global rate.
 *
 * @example
 * ```ts
 * RUNTIME_OP_CLASSES['relay:publish']; // 'relay:write'
 * RUNTIME_OP_CLASSES.control; // null
 * ```
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

/** The runtime firewall's state, as far as kernl configures it. */
export type RuntimeFirewallState = Pick<FirewallStateContainer, 'setRateLimit' | 'setGlobalRate' | 'setUnfocusedMultiplier' | 'setBurstGuard' | 'persist'>;

/**
 * Install the guard profile's rates for an applet in the runtime firewall.
 *
 * The runtime's firewall runs before every dispatch, including the envelopes
 * kernl held for a hidden window and released later, so the profile's limits
 * are pushed into it when a window mounts and again when the profile changes.
 * No policy is set: kehto's `allow` policy bypasses every rate, matcher and
 * burst check, and the user's choices to deny or block live in the grants
 * layer, not here.
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
export function applyRuntimeFirewallRules(firewallState: RuntimeFirewallState, config: GuardConfig, napplet: string): void {
  const rules = runtimeFirewallRules(config, napplet);
  for (const rule of rules.rates) firewallState.setRateLimit(napplet, rule.opClass, rule.limit);
  firewallState.setGlobalRate(napplet, rules.globalRate);
  firewallState.persist();
}

/**
 * Apply a profile's shell-wide limits to the runtime firewall: the unfocused
 * multiplier, which the runtime applies with the focus kernl reports through
 * `getFocusContext`, and the startup burst guard.
 *
 * @param firewallState - `bridge.runtime.firewallState`.
 * @param config - The guard configuration of the profile now in force.
 * @returns Nothing; the firewall state is mutated and persisted.
 * @example
 * ```ts
 * applyRuntimeFirewallProfile(bridge.runtime.firewallState, createGuardConfig('balanced'));
 * bridge.runtime.firewallState.getConfig().unfocusedMultiplier; // 0.5
 * ```
 */
export function applyRuntimeFirewallProfile(firewallState: RuntimeFirewallState, config: GuardConfig): void {
  firewallState.setUnfocusedMultiplier(config.firewall.unfocusedMultiplier);
  firewallState.setBurstGuard(config.firewall.burstGuard);
  firewallState.persist();
}

const GUARD_OP_CLASSES: ReadonlyMap<string, OpClass> = new Map(
  Object.entries(RUNTIME_OP_CLASSES).flatMap(([opClass, runtimeClass]) => (runtimeClass ? [[runtimeClass, opClass as OpClass] as const] : [])),
);

/**
 * Turn a runtime firewall event into a guard event. The runtime's event
 * carries the applet's message; the guard event never does, so nothing the
 * applet sent reaches the guard log. Reasons follow the guard's vocabulary:
 * a rate is `rate:<class>`, the startup burst is `flood:startup`, anything
 * else is `runtime:<ruleId>`.
 *
 * @param event - What the runtime firewall reported.
 * @param at - When it happened.
 * @returns The guard event.
 * @example
 * ```ts
 * toGuardEvent({ windowId: 'w1', napplet: 'chat', opClass: 'state:write', decision: 'reject', action: 'block', ruleId: 'rate:opclass', reason: '…' }, 0).reason;
 * // 'rate:storage:write'
 * ```
 */
export function toGuardEvent(event: FirewallEvent, at: number): GuardEvent {
  const opClass = GUARD_OP_CLASSES.get(event.opClass) ?? 'generic';
  const reason = event.ruleId === 'burst' ? 'flood:startup' : event.ruleId.startsWith('rate:') ? `rate:${opClass}` : `runtime:${event.ruleId}`;
  const disposition = event.decision === 'pass' ? 'flag' : 'reject';
  return { disposition, windowId: event.windowId, napplet: event.napplet, opClass, reason, at };
}

/** The runtime firewall hooks kernl hands to `createShellAdapter`. */
export interface RuntimeFirewallHooks {
  readonly firewallPersistence: FirewallPersistence;
  readonly onFirewallEvent: (event: FirewallEvent) => void;
}

/** Options for {@link createRuntimeFirewallHooks}. */
export interface RuntimeFirewallHooksOptions {
  /** The host storage; the config is kept under {@link RUNTIME_FIREWALL_STORAGE_KEY}. */
  readonly storage: StorageLike;
  /** Receives every runtime refusal and flag as a guard event. */
  readonly onEvent: (event: GuardEvent) => void;
  readonly now?: () => number;
}

/**
 * The runtime firewall's persistence and event sink, through kernl's host
 * storage and guard event stream. These report what the runtime itself
 * refused, which is the startup burst and anything over budget when held
 * envelopes are released; what kernl drops before the runtime sees it is
 * reported by kernl's own guard layers.
 *
 * @param options - Host storage, the guard event sink and a clock.
 * @returns `firewallPersistence` and `onFirewallEvent` for the `ShellAdapter`.
 * @example
 * ```ts
 * const hooks = createRuntimeFirewallHooks({ storage: localStorage, onEvent: (event) => log.push(event) });
 * const adapter: ShellAdapter = { ...rest, ...hooks };
 * ```
 */
export function createRuntimeFirewallHooks(options: RuntimeFirewallHooksOptions): RuntimeFirewallHooks {
  const now = options.now ?? Date.now;
  return {
    firewallPersistence: {
      persist: (data) => options.storage.setItem(RUNTIME_FIREWALL_STORAGE_KEY, data),
      load: () => options.storage.getItem(RUNTIME_FIREWALL_STORAGE_KEY),
    },
    onFirewallEvent: (event) => options.onEvent(toGuardEvent(event, now())),
  };
}
