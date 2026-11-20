import type { MountPlan, ShellKernl } from './contract';
import { explainOpenFailure } from './launcher-reasons';

/** What reloading a window touches. */
export interface ReloadDeps {
  readonly kernl: Pick<ShellKernl, 'plan'>;
  readonly windows: {
    get(id: string): { readonly plan: MountPlan } | undefined;
    reload(id: string, plan: MountPlan): Promise<void>;
  };
  /** Tell the person why it could not start again. */
  readonly onproblem: (title: string, body: string) => void;
  /** Where a reason the shell has no words for is left; the console by default. */
  readonly warn?: (message: string, reason: unknown) => void;
}

/**
 * Start a window's applet again. The frame cannot be reused (NIP-5D: a revoked frame is never
 * re-bound, and a second load revokes it), so this plans the verified bytes the shell already holds
 * under a new window id, which the window takes over in place. Planning admits the applet again, so a
 * firewall question can come back; a blocked applet is refused with its reason. One reload per window
 * runs at a time, and one whose window closed while it was planned is dropped.
 *
 * @param deps - The shell, the windows and where problems go.
 * @returns Reload one window by id.
 * @example
 * ```ts
 * const reload = createReloader({ kernl, windows, onproblem: (title, body) => notices.push({ title, body, tone: 'warning' }) });
 * await reload('applet-3');
 * ```
 */
export function createReloader(deps: ReloadDeps): (windowId: string) => Promise<void> {
  const pending = new Set<string>();
  return async (windowId) => {
    const win = deps.windows.get(windowId);
    if (!win || pending.has(windowId)) return;
    pending.add(windowId);
    try {
      const plan = await deps.kernl.plan(win.plan.summary);
      if (deps.windows.get(windowId)) await deps.windows.reload(windowId, plan);
    } catch (reason) {
      deps.onproblem(`${win.plan.summary.title} could not start again`, explainOpenFailure(reason, deps.warn));
    } finally {
      pending.delete(windowId);
    }
  };
}
