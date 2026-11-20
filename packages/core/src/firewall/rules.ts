import { BehaviorSubject, type Observable } from 'rxjs';
import {
  createPermissionRules,
  deserializePermissionRules,
  resolvePermissionRule,
  serializePermissionRules,
  setPermissionRule,
  type PermissionPrincipal,
  type PermissionRequest,
  type PermissionRequirement,
  type PermissionRuleAction,
  type PermissionRules,
} from '@kehto/firewall';
import type { FirewallRuleTarget, StorageLike } from '../types.js';

/**
 * Where the person's firewall rules are kept in the host storage.
 *
 * @example
 * ```ts
 * localStorage.getItem(FIREWALL_RULES_STORAGE_KEY); // kehto's serialised rules, once the person changed one
 * ```
 */
export const FIREWALL_RULES_STORAGE_KEY = 'kernl:firewall-rules:v1';

/**
 * The rules a shell starts with: everything the person granted is allowed
 * without asking, and opening a link outside the shell asks every time.
 *
 * The grants layer already decided which domains an applet holds, so asking
 * again for each of them would bury the one question that matters under a
 * wall of prompts. A link leaves the shell, which no grant describes, so it is
 * the one request that always asks (D-049).
 *
 * @returns Fresh rules; change them with kehto's `setPermissionRule`.
 * @example
 * ```ts
 * const rules = defaultFirewallRules();
 * rules.default; // 'allow'
 * rules.operations['link.open']; // 'ask'
 * ```
 */
export function defaultFirewallRules(): PermissionRules {
  return createPermissionRules({ default: 'allow', operations: { 'link.open': 'ask' } });
}

/** The person's firewall rules, kept across visits. */
export interface FirewallRules {
  /** The rules in force. */
  current(): PermissionRules;
  readonly rules$: Observable<PermissionRules>;
  /**
   * Set one rule, or remove it with `undefined` so the next wider rule applies.
   * Throws `invalid:rule` for a target kehto refuses.
   */
  set(target: FirewallRuleTarget, action: PermissionRuleAction | undefined): void;
  /** Go back to {@link defaultFirewallRules}. */
  restoreDefaults(): void;
  /** What the rules say about a request no stored answer covers; kehto's `defaultDecision`. */
  decide(request: Pick<PermissionRequest, 'principal'>, missing: readonly PermissionRequirement[]): PermissionRuleAction;
  /** Whether the rules allow one requirement for one applet without asking. */
  allows(principal: PermissionPrincipal, requirement: PermissionRequirement): boolean;
}

function load(storage: StorageLike): PermissionRules {
  const raw = storage.getItem(FIREWALL_RULES_STORAGE_KEY);
  if (raw === null) return defaultFirewallRules();
  const loaded = deserializePermissionRules(raw);
  // A damaged document falls back to the shipped rules: it must never widen what is allowed.
  return loaded.ok ? loaded.rules : defaultFirewallRules();
}

/**
 * The firewall's rules over the host storage.
 *
 * A request no stored answer covers is decided by the most specific rule kehto
 * finds: the applet's rule for that request, for its domain, the applet's
 * default, then the same three for every applet. Any `deny` among a request's
 * requirements refuses it, any `ask` asks, and it is allowed without asking
 * only when every requirement is. Rules are keyed by an applet's catalogue id,
 * so they survive a new version; stored answers stay tied to the exact code.
 *
 * @param storage - The host storage; rules live under {@link FIREWALL_RULES_STORAGE_KEY}.
 * @returns The rules.
 * @example
 * ```ts
 * const rules = createFirewallRules(localStorage);
 * rules.set({ domain: 'relay' }, 'ask');
 * rules.set({ applet: summary.manifest.catalogId, operation: 'link.open' }, 'allow');
 * ```
 */
export function createFirewallRules(storage: StorageLike): FirewallRules {
  const rules$ = new BehaviorSubject<PermissionRules>(load(storage));
  const replace = (next: PermissionRules): void => {
    storage.setItem(FIREWALL_RULES_STORAGE_KEY, serializePermissionRules(next));
    rules$.next(next);
  };
  const allows = (principal: PermissionPrincipal, requirement: PermissionRequirement): boolean => resolvePermissionRule(rules$.value, principal, requirement) === 'allow';
  return {
    current: () => rules$.value,
    rules$: rules$.asObservable(),
    set(target, action) {
      const { applet, ...rest } = target;
      let next: PermissionRules;
      try {
        next = setPermissionRule(rules$.value, { ...rest, ...(applet === undefined ? {} : { napplet: applet }) }, action);
      } catch {
        throw new Error('invalid:rule');
      }
      replace(next);
    },
    restoreDefaults: () => replace(defaultFirewallRules()),
    decide(request, missing) {
      const actions = missing.map((requirement) => resolvePermissionRule(rules$.value, request.principal, requirement));
      if (actions.includes('deny')) return 'deny';
      return actions.every((action) => action === 'allow') ? 'allow' : 'ask';
    },
    allows,
  };
}
