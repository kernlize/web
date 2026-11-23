import { createShortcutsService, type ShortcutSettings } from '../keys/shortcuts.js';
import type { KernlModule } from './module.js';

/**
 * Applets' keyboard shortcuts, the `keys` domain (D-054): an applet binds chords, its actions run
 * only while its window has focus, and the chords the host reserves are never bound. Without this
 * module the shell does not offer `keys`, and it leaves the baseline every applet starts with.
 *
 * @param settings - The chords the host keeps for itself and where key presses are heard.
 * @returns The module.
 * @example
 * ```ts
 * createKernl({ host, modules: [keysModule({ reserved: ['Alt+/'] })] });
 * ```
 */
export function keysModule(settings: ShortcutSettings = {}): KernlModule<'keys'> {
  return {
    id: 'keys',
    setup(context) {
      const keys = createShortcutsService({ ...settings, isFocused: (windowId) => context.isFocused(windowId) });
      return { services: { keys }, dispose: () => keys.destroy() };
    },
  };
}
