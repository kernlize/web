import { Subject, map, startWith, type Observable } from 'rxjs';
import { DEFAULT_RULE_GRANT_PREFIX, type PermissionGrant, type RuntimePermissions } from '@kehto/runtime';
import type { Firewall, FirewallDecision } from '../types.js';
import type { FirewallRules } from './rules.js';

/** Options for {@link createFirewall}. */
export interface FirewallOptions {
  readonly rules: FirewallRules;
  /** kehto's grant store, from `bridge.runtime.permissions`. */
  readonly permissions: RuntimePermissions;
}

/** The firewall surface plus the hook the shell calls when the person answered a question. */
export interface KernlFirewall extends Firewall {
  /** Tell `decisions$` the answers may have changed. */
  touch(): void;
  close(): void;
}

function toDecision(grant: PermissionGrant): FirewallDecision | undefined {
  // A `once` answer is used up by the request it was given for; it is never in force afterwards.
  if (grant.lifetime === 'once' || grant.principal.kind !== 'verified') return undefined;
  const { permission } = grant;
  const kind = permission.category === 'interface' ? 'access' : permission.category === 'network' ? 'network' : 'resource';
  return {
    id: grant.id,
    catalogId: grant.principal.manifestKey,
    hash: grant.principal.artifactHash,
    request: { kind, domain: permission.domain, operation: permission.operation, target: permission.scope.value },
    effect: grant.effect,
    lifetime: grant.lifetime === 'persistent' ? 'always' : 'session',
    byRule: grant.id.startsWith(DEFAULT_RULE_GRANT_PREFIX),
  };
}

/**
 * The firewall as the host sees it: the rules, and the answers in force.
 *
 * Changing a rule takes back every answer the rules gave that they no longer
 * give, as kehto requires of a host, so a tightened rule applies to applets
 * already running: kehto ends the work those answers covered and kernl stops
 * the window (see `createAppletLifecycle`). Answers the person gave stay until
 * they take them back.
 *
 * @param options - The rules and kehto's grant store.
 * @returns The firewall.
 * @example
 * ```ts
 * const firewall = createFirewall({ rules, permissions: bridge.runtime.permissions });
 * firewall.setRule({ domain: 'relay' }, 'ask');
 * firewall.decisions().filter((decision) => !decision.byRule);
 * ```
 */
export function createFirewall(options: FirewallOptions): KernlFirewall {
  const { rules, permissions } = options;
  const touched$ = new Subject<void>();
  const decisions = (): readonly FirewallDecision[] => permissions.grants.flatMap((grant) => toDecision(grant) ?? []);
  const stopFollowing = permissions.subscribeInvalidation(() => touched$.next());
  const retractRuleAnswers = (): void => {
    const stale = permissions.grants.filter((grant) => grant.id.startsWith(DEFAULT_RULE_GRANT_PREFIX) && !rules.allows(grant.principal, grant.permission));
    for (const grant of stale) permissions.revoke(grant.id);
  };
  return {
    rules: () => rules.current(),
    rules$: rules.rules$,
    setRule(target, action) {
      rules.set(target, action);
      retractRuleAnswers();
    },
    restoreDefaults() {
      rules.restoreDefaults();
      retractRuleAnswers();
    },
    decisions,
    decisions$: touched$.pipe(startWith(undefined), map(decisions)) as Observable<readonly FirewallDecision[]>,
    forget: (id) => permissions.revoke(id),
    forgetAll: () => permissions.clear(),
    touch: () => touched$.next(),
    close() {
      stopFollowing();
      touched$.complete();
    },
  };
}
