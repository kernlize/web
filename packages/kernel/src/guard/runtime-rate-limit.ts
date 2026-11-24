import type { PermissionRateEvent, TemporalPolicy } from '@kehto/runtime';
import { createRateLimitState, evaluateRateLimit, retireRateLimitLifecycle, type RateLimitConfig } from '@kehto/rate-limit';
import { classifyEnvelope, type GuardConfig, type GuardEvent, type OpClass } from '@kernlize/guard';

/*
 * kehto's runtime builds no rate limiter of its own: a host that wants one
 * constructs it from `@kehto/rate-limit` and hands it over as
 * `permissions.rateLimiter`. Everything kernl puts there lives in this module.
 */

/**
 * The guard's operation class for a request as kehto's runtime names it.
 *
 * The runtime charges an operation by the name its service gave it, which for
 * the requests an applet sends is the envelope's type (`relay.publish`,
 * `storage.set`), so the guard's own classification applies. It does not say
 * what kind of post a publish carries, so deletions share the `relay:publish`
 * budget here; kernl's own rate limiter, in front, keeps their separate one.
 *
 * @param operation - The operation name from a runtime observation.
 * @returns The class whose budget the operation spends.
 * @example
 * ```ts
 * runtimeOpClass('relay.publish'); // 'relay:publish'
 * runtimeOpClass('resource.network'); // 'resource:bytes'
 * runtimeOpClass('link.open'); // 'generic'
 * ```
 */
export function runtimeOpClass(operation: string): OpClass {
  return classifyEnvelope({ type: operation });
}

/**
 * Operations the runtime names for a second leg of work it already charged.
 * A download is charged as `resource.bytes`; approving the server it contacts
 * is the same download, so it spends nothing more.
 */
const SECOND_LEGS: ReadonlySet<string> = new Set(['resource.network']);

function soften(budget: RateLimitConfig): RateLimitConfig {
  return budget.action === 'block' ? { ...budget, action: 'flag' } : budget;
}

/**
 * The rate limiter kernl hands to kehto's runtime: the guard profile's budget
 * for each operation class.
 *
 * The runtime charges what it is about to carry out, after kernl's own guard
 * let the envelope through: each request a service puts to the firewall, and
 * the storage, settings and applet-to-applet traffic the runtime serves
 * itself. That includes the envelopes kernl held for a hidden window and
 * released later, which meet the budget at the focus the window has then.
 * The configuration is read on every charge, so a profile change applies at
 * once and counters carry over. Where kehto only observes, because a protocol
 * has no way to refuse, a spent budget flags and never blocks. There is no
 * startup burst here: kernl's ingress guard counts every second of a window's
 * life, and the runtime's count of a first second starts when the window was
 * planned, not when it ran.
 *
 * @param config - The guard configuration in force, read on every charge.
 * @returns The limiter for `permissions.rateLimiter`.
 * @example
 * ```ts
 * const rateLimiter = createRuntimeRateLimiter(() => pipeline.config);
 * const permissions: PermissionAdapter = { ...approvals, rateLimiter };
 * ```
 */
export function createRuntimeRateLimiter(config: () => GuardConfig): TemporalPolicy {
  let state = createRateLimitState();
  return {
    evaluate(observation, mode = 'enforce') {
      if (SECOND_LEGS.has(observation.operation)) return { allowed: true, action: 'ignore', reason: 'within-budget' };
      const opClass = runtimeOpClass(observation.operation);
      const budget = config().rateLimits[opClass];
      const result = evaluateRateLimit(mode === 'observe' ? soften(budget) : budget, state, { ...observation, operation: opClass });
      state = result.state;
      return result;
    },
    retire(subject, lifecycle) {
      state = retireRateLimitLifecycle(state, subject, lifecycle);
    },
  };
}

/**
 * Turn a runtime budget event into a guard event. The runtime's event names
 * the window and the operation and carries nothing the applet sent. Reasons
 * follow the guard's vocabulary: a spent class budget is `rate:<class>`, and a
 * question the firewall did not put to the person because the applet asked
 * too often is `flood:prompts`.
 *
 * @param event - What the runtime reported through `permissions.onRateLimit`.
 * @param napplet - The applet the window runs, as the shell resolved it.
 * @param at - When it happened.
 * @returns The guard event.
 * @example
 * ```ts
 * toGuardEvent({ windowId: 'w1', operation: 'storage.set', action: 'block', reason: 'rate-exceeded' }, 'chat', 0).reason;
 * // 'rate:storage:write'
 * ```
 */
export function toGuardEvent(event: PermissionRateEvent, napplet: string, at: number): GuardEvent {
  const opClass = runtimeOpClass(event.operation);
  const reason = event.operation === 'permission.prompt' ? 'flood:prompts' : `rate:${opClass}`;
  return { disposition: event.action === 'block' ? 'reject' : 'flag', windowId: event.windowId, napplet, opClass, reason, at };
}
