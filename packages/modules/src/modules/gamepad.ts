import { createControllerService, type ControllerSettings } from '../gamepad/controllers.js';
import type { KernlModule } from '@kernlize/kernel';

/**
 * Offer controller input through the shell, with live readings only for its focused applet (D-075).
 * Without a native reader, or when the host disables it, this module offers no domain.
 *
 * @param settings - The page holding the controller reader and whether to offer it.
 * @returns The module.
 * @example
 * ```ts
 * createKernel({ host, modules: [gamepadModule({ window })] });
 * ```
 */
export function gamepadModule(settings: ControllerSettings = {}): KernlModule<'gamepad'> {
  return {
    id: 'gamepad',
    setup(context) {
      const gamepad = createControllerService({ ...settings, focusedWindow() {
        for (const id of context.applets().keys()) if (context.isFocused(id)) return id;
        return null;
      } });
      if (!gamepad) return {};
      const focus = context.focusChanges$.subscribe(() => gamepad.refresh());
      return { services: { gamepad }, dispose: () => focus.unsubscribe() };
    },
  };
}
