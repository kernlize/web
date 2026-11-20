import { createRateLimitState, evaluateRateLimit, type RateLimitResult, type RateLimitState } from '@kehto/rate-limit';
import { classifyEnvelope } from './classify.js';
import type { FocusRateLimiter, GuardConfig, GuardEvent, OpClass, RateVerdict } from './types.js';

/** Options for {@link createFocusRateLimiter}. */
export interface FocusRateLimiterOptions {
  readonly config: GuardConfig;
  /** Time source; defaults to `Date.now`. kehto's evaluator never reads a clock itself. */
  readonly now?: () => number;
  /** Receives `reject` and `flag` events derived from each evaluation. */
  readonly onEvent?: (event: GuardEvent) => void;
}

/** kehto keys a budget by `[subject, operation]`; the subject here is the applet. */
function dropApplet(state: RateLimitState, napplet: string): RateLimitState {
  const buckets = Object.fromEntries(Object.entries(state.buckets).filter(([key]) => (JSON.parse(key) as [string, string])[0] !== napplet));
  return { buckets, bursts: state.bursts };
}

function toVerdict(result: RateLimitResult): RateVerdict {
  // A startup burst is never configured here, so the only way out of budget is the class rate.
  const reason = result.reason === 'within-budget' ? 'within-budget' : 'rate-exceeded';
  return { decision: result.allowed ? 'pass' : 'reject', action: result.action, reason };
}

/**
 * Create the focus-aware rate limiter: kehto's pure `evaluateRateLimit`, fed
 * one budget per operation class and the focus the shell observed, never
 * focus the applet claimed.
 *
 * A spent budget whose action is `block` rejects and emits `reject`; one whose
 * action is `flag` passes and emits `flag`. The reason names the class,
 * `rate:<class>`, because that is what a person needs to see. Budgets are kept
 * per applet and class, so two windows of one applet share them.
 *
 * This is temporal protection only. Whether an applet may do something at all
 * is decided by its grants and by the firewall in `@kernlize/core`.
 *
 * @param options - Configuration, time source and event sink.
 * @returns A limiter that keeps the counters for many windows.
 * @example
 * ```ts
 * const limiter = createFocusRateLimiter({ config: createGuardConfig('strict') });
 * const verdict = limiter.observe('w1', 'chat', { type: 'relay.publish' }, { visible: true, focused: true });
 * verdict.decision; // 'pass'
 * ```
 */
export function createFocusRateLimiter(options: FocusRateLimiterOptions): FocusRateLimiter {
  const now = options.now ?? Date.now;
  const onEvent = options.onEvent ?? (() => undefined);
  const { config } = options;
  let state = createRateLimitState();
  const nappletsByWindow = new Map<string, Set<string>>();

  function emit(verdict: RateVerdict, windowId: string, napplet: string, opClass: OpClass, at: number): void {
    if (verdict.reason === 'within-budget' || verdict.action === 'ignore') return;
    onEvent({ disposition: verdict.decision === 'pass' ? 'flag' : 'reject', windowId, napplet, opClass, reason: `rate:${opClass}`, at });
  }

  return {
    observe(windowId, napplet, envelope, visibility) {
      const seen = nappletsByWindow.get(windowId) ?? new Set<string>();
      seen.add(napplet);
      nappletsByWindow.set(windowId, seen);

      const opClass = classifyEnvelope(envelope);
      const at = now();
      const result = evaluateRateLimit(config.rateLimits[opClass], state, {
        subject: napplet,
        operation: opClass,
        lifecycle: windowId,
        elapsedSinceStartMs: 0,
        focused: visibility.focused,
        now: at,
      });
      state = result.state;
      const verdict = toVerdict(result);
      emit(verdict, windowId, napplet, opClass, at);
      return verdict;
    },
    forget(windowId) {
      // Budgets are keyed by applet, so this also resets the budget of another
      // window running the same applet. Revocation is user-driven; that is acceptable.
      for (const napplet of nappletsByWindow.get(windowId) ?? []) state = dropApplet(state, napplet);
      nappletsByWindow.delete(windowId);
    },
  };
}
