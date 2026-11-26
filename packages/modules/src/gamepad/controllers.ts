import { browserGamepadOptions, createGamepadService } from '@kehto/services';
import type { GamepadService } from '@kehto/services';
/**
 * The host's settings for the `gamepad` domain.
 *
 * The shell, never the applet, reads the native controller API: every mounted frame is
 * denied it by Permissions-Policy (security posture rule 4), so a game that navigates
 * with a pad goes through this domain or not at all. "Off" here means the domain is
 * never advertised; the frames stay denied either way.
 */
export interface ControllerSettings {
  /** The window whose native reader and page events the shell uses; the page it runs in by default. */
  readonly window?: Window;
  /** Whether applets may be offered the domain at all; `true` wherever the page can read a controller. */
  readonly offer?: boolean;
}

/**
 * What the shell has to know for {@link createControllerService}: the host's settings and its own focus answer.
 *
 * @example
 * ```ts
 * const deps: ControllerDeps = { focusedWindow: () => parts.pipeline.getVisibility('w1').focused ? 'w1' : null };
 * ```
 */
export interface ControllerDeps extends ControllerSettings {
  /**
   * The window the shell last gave input focus to, or `null` when the person is working in the
   * shell itself. kehto asks this per push, and never takes an applet's word for it.
   */
  readonly focusedWindow: () => string | null;
}

/**
 * The `gamepad` domain (D-075): NAP-GAMEPAD, served by kehto's reference service.
 *
 * Controllers are the person's devices, so the shell owns the only native reader and
 * every mounted frame stays denied (`CONTROLLER_FEATURES`, security posture rule 4).
 * A subscribed applet receives a complete snapshot, but live values only while the
 * window manager says its window is the one the person is working in; every other
 * subscriber gets the neutral snapshot (zero axes, zero timestamps) the proposal
 * requires, so a press in one applet cannot be replayed in another. Focus loss and a
 * hidden page deliver the neutral snapshot at once, and the service stops polling
 * when nobody is subscribed.
 *
 * kehto's service asks the runtime to approve each subscription, so the firewall applies
 * the person's rules (D-056) and the domain is advertised to an applet only
 * when the grants layer put it in force.
 *
 * @param deps - The host's settings and the shell's focus answer.
 * @returns The service to register as `gamepad`, or `undefined` where the page cannot read controllers.
 * @example
 * ```ts
 * const gamepad = createControllerService({ focusedWindow: () => 'w1' });
 * // registry.gamepad = gamepad;
 * ```
 */
export function createControllerService(deps: ControllerDeps): GamepadService | undefined {
  if (deps.offer === false) return undefined;
  const host = deps.window ?? (typeof window === 'undefined' ? undefined : window);
  const reader = host?.navigator as { getGamepads?: () => unknown } | undefined;
  if (!host || typeof reader?.getGamepads !== 'function') return undefined;
  return createGamepadService({
    ...browserGamepadOptions(host),
    // kernl's own focus source, so the input owner is the window the person sees as focused
    // and never the iframe the browser happens to have as `activeElement`.
    getFocusedWindow: deps.focusedWindow,
  });
}
