/**
 * How long after a forwarded key the same key counts as its repeat. A held key
 * first repeats after the system's delay, at most about half a second, and then
 * many times a second.
 *
 * @example
 * ```ts
 * KEY_REPEAT_WINDOW_MS; // 600
 * ```
 */
export const KEY_REPEAT_WINDOW_MS = 600;

/** Decides which `keys.forward` envelopes never reach the guard or the runtime. */
export interface ForwardedKeys {
  /**
   * Whether an envelope is a forwarded key to discard: one from a window that
   * is not the focused one, or the repeat of the key that window forwarded last.
   */
  drops(windowId: string, message: unknown, focused: boolean, at: number): boolean;
  /** Forget a window's last key. */
  forget(windowId: string): void;
}

function chordOf(message: Record<string, unknown>): string {
  return [message.key, message.code, message.ctrl, message.alt, message.shift, message.meta].join('|');
}

/**
 * The filter in front of the guard for keys an applet forwards (D-049).
 *
 * The frame forwards every key it has no binding for, repeats included, so a
 * held key arrives faster than any budget; counted like other traffic it would
 * use up the applet's allowance and then quarantine it for the person's own
 * typing. A repeat is discarded here, uncounted: the shell's shortcuts act on
 * the press. So is a key from a window that is not focused, which the person
 * cannot have typed there.
 *
 * @returns The filter.
 * @example
 * ```ts
 * const forwarded = createForwardedKeys();
 * forwarded.drops('w1', { type: 'keys.forward', key: 'a', code: 'KeyA' }, true, 0); // false: the press
 * forwarded.drops('w1', { type: 'keys.forward', key: 'a', code: 'KeyA' }, true, 500); // true: its repeat
 * ```
 */
export function createForwardedKeys(): ForwardedKeys {
  const last = new Map<string, { readonly chord: string; readonly at: number }>();
  return {
    drops(windowId, message, focused, at) {
      if (typeof message !== 'object' || message === null) return false;
      const envelope = message as Record<string, unknown>;
      if (envelope.type !== 'keys.forward') return false;
      if (!focused) return true;
      const chord = chordOf(envelope);
      const previous = last.get(windowId);
      // A repeat renews the window, so the key stays a repeat for as long as it is held.
      last.set(windowId, { chord, at });
      return previous !== undefined && previous.chord === chord && at - previous.at < KEY_REPEAT_WINDOW_MS;
    },
    forget: (windowId) => void last.delete(windowId),
  };
}
