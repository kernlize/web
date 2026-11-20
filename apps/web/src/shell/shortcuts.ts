import type { ShortcutKey } from './contract';

/** The shell's own chords. An applet asking for one is answered without a binding (D-054). */
export const SHELL_CHORDS: readonly string[] = Object.freeze(['Alt+/']);

/** What one of the shell's own keys does. */
export type ShellShortcut = 'dismiss' | 'launcher';

/**
 * How the core hands the shell a key an applet had no shortcut for. The shell fills `run` once it
 * is on screen; until then such keys go nowhere.
 */
export interface ShortcutRunner {
  run?: (key: ShortcutKey) => void;
}

/** Which of the shell's shortcuts a key press is, whether it was pressed on the shell or inside an applet. */
export function shellShortcut(key: Pick<ShortcutKey, 'key' | 'code' | 'altKey'>): ShellShortcut | undefined {
  if (key.key === 'Escape') return 'dismiss';
  // Some layouts type another character with Alt held, so the physical key counts too.
  if (key.altKey && (key.key === '/' || key.code === 'Slash')) return 'launcher';
  return undefined;
}
