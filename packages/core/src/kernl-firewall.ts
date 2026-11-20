import type { Subject } from 'rxjs';
import type { PermissionAdapter, Runtime } from '@kehto/runtime';
import { permissionRuleSubject } from '@kehto/firewall';
import type { GuardEvent } from '@kernlize/guard';
import type { AppletSummary, FirewallApplet, KernlHost } from './types.js';
import type { MountedApplet } from './applets/mount.js';
import type { GuardPipeline } from './guard/pipeline.js';
import { createRuntimeRateLimiter, toGuardEvent } from './guard/runtime-rate-limit.js';
import { createAppletAdmissions, type AppletAdmissions } from './firewall/admission.js';
import { createFirewall, type KernlFirewall } from './firewall/firewall.js';
import { createFirewallPermissions } from './firewall/permissions.js';
import { createFirewallRules } from './firewall/rules.js';

/** The legacy rate gate's stored configuration; nothing reads it since the firewall took over (D-050). */
const RETIRED_STORAGE_KEYS: readonly string[] = ['kernl:firewall:v1'];

/** What the shell's firewall needs from the rest of the shell. */
export interface ShellFirewallParts {
  readonly host: KernlHost;
  /** Its configuration is the guard profile in force, whose budgets the runtime charges against. */
  readonly pipeline: Pick<GuardPipeline, 'config'>;
  /** Live handles keyed by window id; a budget report names the applet its window runs. */
  readonly handles: ReadonlyMap<string, MountedApplet>;
  readonly guardEvents$: Subject<GuardEvent>;
}

/** The firewall's host side before kehto's runtime exists, and the rest once it does. */
export interface ShellFirewall {
  /** For `ShellAdapter.permissions`. */
  readonly permissions: PermissionAdapter;
  /** Tell the firewall which applet a plan is for, so its questions can name it. */
  remember(summary: AppletSummary): void;
  /** The firewall the host sees and the admissions the lifecycle asks, over the runtime kehto built with `permissions`. */
  attach(runtime: Runtime): { readonly firewall: KernlFirewall; readonly admissions: AppletAdmissions };
}

/** The applet across versions and the exact code, as both a summary and kehto's principal name them. */
function plannedKey(subject: string, hash: string): string {
  return `${subject}\n${hash}`;
}

/**
 * Assemble one shell's firewall (D-050): the person's rules, their stored
 * answers, the question put through the host, and the guard profile's budgets
 * for what the runtime carries out.
 *
 * kehto's runtime is built from the adapter this hands `permissions` to, so
 * the surface the host and the lifecycle use comes afterwards, from `attach`.
 * The legacy rate gate's stored configuration is removed on the way.
 *
 * @param parts - Host, guard pipeline, live handles and the guard event stream.
 * @returns The permission adapter, the applet register and `attach`.
 * @example
 * ```ts
 * const guarding = createShellFirewall({ host, pipeline, handles, guardEvents$ });
 * const bridge = createShellBridge({ ...adapter, permissions: guarding.permissions });
 * const { firewall, admissions } = guarding.attach(bridge.runtime);
 * ```
 */
export function createShellFirewall({ host, pipeline, handles, guardEvents$ }: ShellFirewallParts): ShellFirewall {
  for (const key of RETIRED_STORAGE_KEYS) host.storage.removeItem(key);
  const rules = createFirewallRules(host.storage);
  const now = host.now ? host.now.bind(host) : Date.now;
  const presentApproval = host.presentApproval?.bind(host);
  const planned = new Map<string, FirewallApplet>();
  let firewall: KernlFirewall | undefined;
  const asking: Pick<KernlHost, 'presentApproval'> = presentApproval ? {
    presentApproval: (prompt) => presentApproval({
      ...prompt,
      resolve(choice) {
        prompt.resolve(choice);
        // kehto stores the answer in the turn after this one; then the answers in force have changed.
        setTimeout(() => firewall?.touch(), 0);
      },
    }),
  } : {};
  const permissions = createFirewallPermissions({
    host: { storage: host.storage, notify: (notice) => host.notify(notice), ...(host.now ? { now } : {}), ...asking },
    rules,
    appletOf: (principal) => planned.get(plannedKey(permissionRuleSubject(principal), principal.artifactHash)),
    rateLimiter: createRuntimeRateLimiter(() => pipeline.config),
    onRateLimit: (event) => guardEvents$.next(toGuardEvent(event, handles.get(event.windowId)?.summary.identity.dTag ?? 'unknown', now())),
  });
  return {
    permissions,
    remember(summary) {
      const { catalogId } = summary.manifest;
      planned.set(plannedKey(catalogId, summary.identity.hash), { title: summary.title, catalogId, identity: summary.identity });
    },
    attach(runtime) {
      // `permissions` is always configured here, so the runtime always has its management surface.
      firewall = createFirewall({ rules, permissions: runtime.permissions as NonNullable<Runtime['permissions']> });
      return { firewall, admissions: createAppletAdmissions(runtime, now) };
    },
  };
}
