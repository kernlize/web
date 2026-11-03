import { BehaviorSubject } from 'rxjs';
import { denyNappletControllerAccess, type OriginRegistry, type ShellBridge } from '@kehto/shell';
import type { WindowVisibility } from '@kernl/guard';
import type { AppletHandle, AppletStatus, FrameLike, MountPlan } from '../types.js';

/** The Permissions-Policy `denyNappletControllerAccess` sets, for frames that cannot report their own. */
export const CONTROLLER_DENY_POLICY = "gamepad 'none'; hid 'none'; usb 'none'";

/** What the guard needs to know about a mounted window. */
export interface MountGuardHooks {
  setVisibility(windowId: string, visibility: WindowVisibility): void;
  /** Drop every queue and counter for the window. */
  forget(windowId: string): void;
}

/** Dependencies for {@link mountApplet}. */
export interface MountDeps {
  readonly bridge: Pick<ShellBridge, 'observeFrame' | 'revokeNapplet'>;
  readonly originRegistry: Pick<OriginRegistry, 'register' | 'setEnvironment' | 'unregister'>;
  readonly guard: MountGuardHooks;
  /** Called after the frame was removed because the bridge revoked the binding. */
  readonly onRevoked?: (windowId: string, reason: string) => void;
}

/** An {@link AppletHandle} with the entry point the bridge's revocation hook calls. */
export interface MountedApplet extends AppletHandle {
  /** Mark the applet revoked and remove its frame. Idempotent with `close`. */
  revoked(reason: string): void;
}

function hasGetAttribute(frame: FrameLike): frame is FrameLike & { getAttribute(name: string): string | null } {
  return typeof (frame as { getAttribute?: unknown }).getAttribute === 'function';
}

function harden(frame: FrameLike): void {
  if (typeof frame.sandbox === 'string') frame.sandbox = 'allow-scripts';
  else frame.sandbox.add('allow-scripts');
  if (hasGetAttribute(frame)) denyNappletControllerAccess(frame);
  else frame.setAttribute('allow', CONTROLLER_DENY_POLICY);
}

/**
 * Put a planned applet into a frame, in the NIP-5D order the shell depends on:
 * harden the frame, register its window with the verified identity, freeze its
 * environment, start watching for a second load, then assign `srcdoc`. The
 * status moves to `running` on the frame's first load.
 *
 * `close()` revokes the binding through the bridge, which closes the port and
 * destroys sessions and grants, then removes the frame. When the bridge revokes
 * the binding on its own, `revoked()` removes the frame and tells the host. The
 * frame is removed on every revocation reason; it is never reused.
 *
 * @param plan - The plan from {@link planMount}.
 * @param frame - An iframe, or any object with its shape, already in the DOM.
 * @param deps - Bridge, origin registry, guard hooks and the host's revocation callback.
 * @returns The running applet's handle.
 * @throws `invalid:frame-detached` when the frame has no `contentWindow`.
 * @example
 * ```ts
 * const handle = mountApplet(plan, iframe, { bridge, originRegistry, guard, onRevoked });
 * handle.setVisibility({ visible: true, focused: true });
 * handle.close();
 * ```
 */
export function mountApplet(plan: MountPlan, frame: FrameLike, deps: MountDeps): MountedApplet {
  const win = frame.contentWindow;
  if (!win) throw new Error('invalid:frame-detached');
  const { windowId } = plan;
  const status$ = new BehaviorSubject<AppletStatus>('mounting');
  let finished = false;

  harden(frame);
  deps.originRegistry.register(win, windowId, { dTag: plan.summary.identity.dTag, aggregateHash: plan.summary.identity.hash });
  deps.originRegistry.setEnvironment(win, plan.environment);
  const stopObserving = deps.bridge.observeFrame(frame, windowId);
  const onFirstLoad = (): void => {
    frame.removeEventListener('load', onFirstLoad);
    status$.next('running');
  };
  frame.addEventListener('load', onFirstLoad);
  frame.srcdoc = plan.srcdoc;

  const teardown = (status: AppletStatus): void => {
    finished = true;
    stopObserving();
    frame.removeEventListener('load', onFirstLoad);
    frame.remove();
    deps.guard.forget(windowId);
    status$.next(status);
  };

  return {
    windowId,
    summary: plan.summary,
    status$,
    get status() {
      return status$.value;
    },
    setVisibility: (visibility) => deps.guard.setVisibility(windowId, visibility),
    close() {
      if (finished) return;
      finished = true;
      deps.bridge.revokeNapplet(windowId, 'host');
      deps.originRegistry.unregister(windowId);
      teardown('closed');
    },
    revoked(reason) {
      if (finished) return;
      teardown('revoked');
      deps.onRevoked?.(windowId, reason);
    },
  };
}
