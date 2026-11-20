/** Options for {@link createKeymapHold}. */
export interface KeymapHoldOptions {
  /** How long the runtime's startup burst guard watches a new window, in milliseconds. */
  readonly startupMs: () => number;
  /** Called once a window's startup window has passed, to hand on what was held for it. */
  readonly release: (windowId: string) => void;
}

/** Holds an applet's shortcut registrations until the runtime will take them. */
export interface KeymapHold {
  /**
   * Note an envelope from a window and say whether to hold it: a shortcut
   * registration from a window whose startup window has not passed.
   */
  holds(windowId: string, message: unknown, at: number): boolean;
  /** Whether registrations are being held for a window right now. */
  holding(windowId: string): boolean;
  /** Forget a window and stop waiting for it. */
  forget(windowId: string): void;
}

interface Startup {
  readonly firstSeen: number;
  timer?: ReturnType<typeof setTimeout>;
  passed: boolean;
}

const REGISTRATIONS: ReadonlySet<unknown> = new Set(['keys.registerAction', 'keys.unregisterAction']);

function isRegistration(message: unknown): boolean {
  return typeof message === 'object' && message !== null && REGISTRATIONS.has((message as { type?: unknown }).type);
}

/**
 * The wait in front of the runtime for an applet's keymap (D-049).
 *
 * An applet registers its shortcuts as it starts, a dozen or more at once,
 * which is exactly when the runtime's startup burst guard lets fewest
 * envelopes through and answers none of the ones it refuses. Registrations
 * that arrive in a window's startup window are held, in order, and handed on
 * together when it has passed, where they meet the ordinary rates. Everything
 * registered later goes straight through.
 *
 * @param options - The length of the startup window and what to do when it has passed.
 * @returns The hold.
 * @example
 * ```ts
 * const hold = createKeymapHold({ startupMs: () => 1000, release: (windowId) => bridge.releaseDeferred(windowId) });
 * hold.holds('w1', { type: 'keys.registerAction' }, Date.now()); // true: held until the window's first second is over
 * ```
 */
export function createKeymapHold(options: KeymapHoldOptions): KeymapHold {
  const windows = new Map<string, Startup>();
  return {
    holds(windowId, message, at) {
      let startup = windows.get(windowId);
      if (!startup) {
        startup = { firstSeen: at, passed: false };
        windows.set(windowId, startup);
      }
      if (startup.passed || !isRegistration(message)) return false;
      // One wait per window: a registration that arrives while others are held joins them, so none overtakes another.
      if (startup.timer !== undefined) return true;
      const remaining = options.startupMs() - (at - startup.firstSeen);
      if (remaining <= 0) {
        startup.passed = true;
        return false;
      }
      const waiting = startup;
      waiting.timer = setTimeout(() => {
        delete waiting.timer;
        waiting.passed = true;
        options.release(windowId);
      }, remaining);
      return true;
    },
    holding: (windowId) => windows.get(windowId)?.timer !== undefined,
    forget(windowId) {
      clearTimeout(windows.get(windowId)?.timer);
      windows.delete(windowId);
    },
  };
}
