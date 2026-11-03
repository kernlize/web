import { classifyEnvelope } from './classify.js';
import type { GuardConfig, GuardEnvelope, GuardEvent, OpClass, VisibilityGate, WindowVisibility } from './types.js';

/** Options for {@link createVisibilityGate}. */
export interface VisibilityGateOptions {
  readonly config: GuardConfig;
  /** Receives a `reject` event when a hidden window's defer queue overflows. */
  readonly onEvent?: (event: GuardEvent) => void;
  /** Time source; defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * Resolves the applet identity for a window so overflow events name the
   * applet. The gate is keyed by window alone; without a resolver events
   * report `unknown`.
   */
  readonly nappletFor?: (windowId: string) => string;
}

interface GateWindow {
  visibility: WindowVisibility;
  readonly queue: GuardEnvelope[];
}

/** A window the shell has not reported on is treated as visible and unfocused. */
const UNKNOWN_VISIBILITY: WindowVisibility = { visible: true, focused: false };

/**
 * Create the gate that holds a hidden window's traffic until it is visible again.
 *
 * Deferral is a privacy and resource measure, not a rate limit: a minimised
 * applet should not be fetching or publishing while the user cannot see it.
 * `control` envelopes are never deferred so a hidden window can still be
 * closed, themed or asked for its identity.
 *
 * @param options - Configuration, event sink and time source.
 * @returns A visibility gate for many windows.
 * @example
 * ```ts
 * const gate = createVisibilityGate({ config: createGuardConfig('strict') });
 * gate.setVisibility('w1', { visible: false, focused: false });
 * gate.shouldDefer('w1', 'relay:subscribe'); // true
 * gate.defer('w1', { type: 'relay.subscribe' }); // true
 * gate.setVisibility('w1', { visible: true, focused: true });
 * gate.drain('w1'); // [{ type: 'relay.subscribe' }]
 * ```
 */
export function createVisibilityGate(options: VisibilityGateOptions): VisibilityGate {
  const { config } = options;
  const now = options.now ?? Date.now;
  const onEvent = options.onEvent ?? (() => undefined);
  const nappletFor = options.nappletFor ?? (() => 'unknown');
  const windows = new Map<string, GateWindow>();

  function window(windowId: string): GateWindow {
    const existing = windows.get(windowId);
    if (existing) return existing;
    const created: GateWindow = { visibility: UNKNOWN_VISIBILITY, queue: [] };
    windows.set(windowId, created);
    return created;
  }

  function getVisibility(windowId: string): WindowVisibility {
    return windows.get(windowId)?.visibility ?? UNKNOWN_VISIBILITY;
  }

  return {
    setVisibility(windowId, visibility) {
      window(windowId).visibility = visibility;
    },
    getVisibility,
    shouldDefer(windowId, opClass: OpClass) {
      return !getVisibility(windowId).visible && opClass !== 'control';
    },
    defer(windowId, envelope) {
      const entry = window(windowId);
      if (entry.queue.length >= config.limits.deferQueue) {
        onEvent({
          disposition: 'reject',
          windowId,
          napplet: nappletFor(windowId),
          opClass: classifyEnvelope(envelope),
          reason: 'defer:queue-full',
          at: now(),
        });
        return false;
      }
      entry.queue.push(envelope);
      return true;
    },
    drain(windowId) {
      const entry = windows.get(windowId);
      if (!entry) return [];
      return entry.queue.splice(0);
    },
    forget(windowId) {
      windows.delete(windowId);
    },
  };
}
