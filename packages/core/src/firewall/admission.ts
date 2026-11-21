import type { PermissionAdmission, Runtime } from '@kehto/runtime';
import type { ShellEnvironment } from '@kehto/shell';
import type { AppletSummary } from '../types.js';
import { permissionPrincipalFor } from './permissions.js';

/**
 * How many planned windows may wait to be mounted. A host that plans and never
 * mounts would otherwise leave a session behind for each; past this, the
 * oldest plan is dropped and mounting it fails with `denied:admission-expired`.
 *
 * @example
 * ```ts
 * MAX_UNMOUNTED_PLANS; // 16
 * ```
 */
export const MAX_UNMOUNTED_PLANS = 16;

/** What admission needs from kehto's runtime. */
export type AdmissionRuntime = Pick<Runtime, 'sessionRegistry' | 'permissions' | 'destroyWindow'>;

/** The firewall's say over which applets start, and with which domains. */
export interface AppletAdmissions {
  /**
   * Put an applet's start to the firewall, before any of its code runs.
   * Resolves the domains it starts with; `shell` is always among them when offered.
   * Throws `denied:firewall` when a domain the applet requires was refused,
   * and `unavailable:firewall` when the firewall could not decide.
   */
  admit(windowId: string, summary: AppletSummary, environment: ShellEnvironment): Promise<readonly string[]>;
  /** Whether the window's admission still stands: nothing it was admitted under was taken back. */
  isCurrent(windowId: string): boolean;
  /** The window was mounted, so it no longer counts as waiting. */
  mounted(windowId: string): void;
  /** Whether the window was planned and admitted, and is still waiting to be mounted: neither mounted nor given up on. */
  isWaiting(windowId: string): boolean;
  /** Forget a window and end the session admission opened for it. */
  discard(windowId: string): void;
  /** Call `listener` whenever an answer is taken back; returns the unsubscribe. */
  onInvalidated(listener: () => void): () => void;
  /** Discard every window still waiting to be mounted. */
  close(): void;
}

function failure(status: Exclude<PermissionAdmission['status'], 'admitted'>): Error {
  return new Error(status === 'denied' || status === 'cancelled' ? 'denied:firewall' : 'unavailable:firewall');
}

/**
 * Admit applets through kehto's firewall before they run.
 *
 * kehto dispatches nothing for a window whose session holds no admission, so
 * kernl opens the session itself when it plans the window, under the verified
 * principal, and asks the firewall for every domain the grants layer left the
 * applet. Domains the applet requires are decided together and refuse the
 * start when refused; each other domain is decided on its own and is simply
 * left out when refused. With kernl's shipped rules none of this asks the
 * person anything. `shell` is the read-only control plane and is not a
 * permission, as in kehto's own launcher.
 *
 * @param runtime - kehto's runtime, with `permissions` configured.
 * @param now - Clock for the session's registration time.
 * @returns The admissions.
 * @example
 * ```ts
 * const admissions = createAppletAdmissions(bridge.runtime, Date.now);
 * const domains = await admissions.admit('applet-1', summary, environment);
 * if (admissions.isCurrent('applet-1')) frame.srcdoc = srcdoc;
 * ```
 */
export function createAppletAdmissions(runtime: AdmissionRuntime, now: () => number): AppletAdmissions {
  const admitted = new Map<string, PermissionAdmission>();
  const waiting = new Set<string>();
  const permissions = (): NonNullable<Runtime['permissions']> => {
    if (!runtime.permissions) throw new Error('unavailable:firewall');
    return runtime.permissions;
  };
  const discard = (windowId: string): void => {
    admitted.delete(windowId);
    waiting.delete(windowId);
    runtime.destroyWindow(windowId);
    runtime.sessionRegistry.unregister(windowId);
  };
  return {
    async admit(windowId, summary, environment) {
      const { identity } = summary;
      const firewall = permissions();
      runtime.sessionRegistry.register(windowId, {
        pubkey: '',
        windowId,
        origin: 'null',
        type: 'nip5d',
        dTag: identity.dTag,
        aggregateHash: identity.hash,
        permissionPrincipal: permissionPrincipalFor(summary),
        registeredAt: now(),
        instanceId: crypto.randomUUID(),
        provenance: 'nip-5d',
      });
      const available = environment.capabilities.domains;
      const asked = available.filter((domain) => domain !== 'shell');
      const required = asked.filter((domain) => summary.requires.includes(domain));
      const optional = asked.filter((domain) => !required.includes(domain));
      const admission = await firewall.admit(windowId, { available, required, optional });
      if (admission.status !== 'admitted') {
        discard(windowId);
        throw failure(admission.status);
      }
      admitted.set(windowId, admission);
      waiting.add(windowId);
      for (const oldest of [...waiting].slice(0, Math.max(0, waiting.size - MAX_UNMOUNTED_PLANS))) discard(oldest);
      return available.filter((domain) => domain === 'shell' || admission.domains.includes(domain));
    },
    isCurrent(windowId) {
      const admission = admitted.get(windowId);
      return admission !== undefined && permissions().isAdmissionCurrent(windowId, admission);
    },
    mounted: (windowId) => void waiting.delete(windowId),
    isWaiting: (windowId) => waiting.has(windowId),
    discard,
    onInvalidated: (listener) => permissions().subscribeInvalidation(listener),
    close() {
      for (const windowId of waiting) discard(windowId);
    },
  };
}
