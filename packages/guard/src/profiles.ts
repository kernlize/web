import type { RateLimitConfig } from '@kehto/rate-limit';
import type { GuardConfig, GuardLimits, GuardProfile, OpClass } from './types.js';

const KIB = 1024;

/**
 * Every profile, tightest first. `strict` is the shell default (D-003); the
 * other two let a user loosen the whole shell from the guard panel.
 *
 * @example
 * ```ts
 * GUARD_PROFILES; // ['strict', 'balanced', 'relaxed']
 * const configs = GUARD_PROFILES.map((profile) => createGuardConfig(profile));
 * ```
 */
export const GUARD_PROFILES: readonly GuardProfile[] = ['strict', 'balanced', 'relaxed'];

/** Exceed action for every budget kernl builds. kehto's own suggestion is `flag`. */
const RATE_EXCEED_ACTION = 'block' as const;

type Rates = GuardLimits['rates'];

const STRICT_RATES: Rates = {
  'relay:subscribe': { capacity: 30, windowMs: 60_000 },
  'relay:publish': { capacity: 20, windowMs: 60_000 },
  'relay:publish:delete': { capacity: 5, windowMs: 60_000 },
  'outbox:subscribe': { capacity: 30, windowMs: 60_000 },
  'outbox:publish': { capacity: 20, windowMs: 60_000 },
  'resource:bytes': { capacity: 120, windowMs: 10_000 },
  'storage:write': { capacity: 60, windowMs: 10_000 },
  'dm:send': { capacity: 20, windowMs: 60_000 },
  'intent:invoke': { capacity: 10, windowMs: 60_000 },
  control: { capacity: 120, windowMs: 10_000 },
  generic: { capacity: 120, windowMs: 10_000 },
};

const STRICT_LIMITS: GuardLimits = {
  ingressBurst: 8,
  ingressQueue: 64,
  quarantineThreshold: 300,
  hiddenResourceAllowance: 8,
  deferQueue: 200,
  maxResourceEnvelopeBytes: 64 * KIB,
  maxSubscribeEnvelopeBytes: 256 * KIB,
  rates: STRICT_RATES,
  unfocusedMultiplier: 0.25,
};

function scaleRates(rates: Rates, factor: number): Rates {
  const scaled: Partial<Record<OpClass, { capacity: number; windowMs: number }>> = {};
  for (const [opClass, rate] of Object.entries(rates) as [OpClass, Rates[OpClass]][]) {
    scaled[opClass] = { capacity: Math.round(rate.capacity * factor), windowMs: rate.windowMs };
  }
  return scaled as Rates;
}

const PROFILE_LIMITS: Readonly<Record<GuardProfile, GuardLimits>> = {
  strict: STRICT_LIMITS,
  balanced: {
    ingressBurst: 12,
    ingressQueue: 128,
    quarantineThreshold: 420,
    hiddenResourceAllowance: 16,
    deferQueue: 400,
    maxResourceEnvelopeBytes: 128 * KIB,
    maxSubscribeEnvelopeBytes: 512 * KIB,
    rates: scaleRates(STRICT_RATES, 2),
    unfocusedMultiplier: 0.5,
  },
  relaxed: {
    ingressBurst: 24,
    ingressQueue: 192,
    quarantineThreshold: 800,
    hiddenResourceAllowance: 32,
    deferQueue: 600,
    maxResourceEnvelopeBytes: 192 * KIB,
    maxSubscribeEnvelopeBytes: 768 * KIB,
    rates: scaleRates(STRICT_RATES, 3),
    unfocusedMultiplier: 0.75,
  },
};

/** The ingress guard counts every second of a window's life, so the class budgets carry no startup burst of their own. */
const NO_STARTUP_BURST: RateLimitConfig['burst'] = Object.freeze({ windowMs: 0, maxOperations: 0, action: 'ignore' });

function deriveRateLimits(limits: GuardLimits): Readonly<Record<OpClass, RateLimitConfig>> {
  const budgets: Partial<Record<OpClass, RateLimitConfig>> = {};
  for (const [opClass, rate] of Object.entries(limits.rates) as [OpClass, Rates[OpClass]][]) {
    budgets[opClass] = Object.freeze({
      capacity: rate.capacity,
      windowMs: rate.windowMs,
      action: RATE_EXCEED_ACTION,
      unfocusedMultiplier: limits.unfocusedMultiplier,
      burst: NO_STARTUP_BURST,
    });
  }
  return Object.freeze(budgets as Record<OpClass, RateLimitConfig>);
}

/**
 * Build the complete guard configuration for a profile.
 *
 * `rateLimits` holds one `@kehto/rate-limit` budget per operation class, each
 * blocking when spent and scaled by the profile's unfocused multiplier. What
 * each layer enforces:
 *
 * - The focus-aware rate limiter charges every envelope against its class
 *   budget, with the focus the shell observed.
 * - The ingress guard enforces `ingressBurst`, `ingressQueue`,
 *   `quarantineThreshold`, `hiddenResourceAllowance` and the envelope size caps.
 * - The visibility gate enforces `deferQueue`.
 * - `@kernlize/core` hands the same budgets to kehto's runtime, which charges
 *   what it actually carries out.
 *
 * @param profile - Which profile to build.
 * @returns The profile's limits and the budgets derived from them.
 * @example
 * ```ts
 * const config = createGuardConfig('strict');
 * config.limits.ingressBurst; // 8
 * config.rateLimits['relay:publish'].capacity; // 20
 * ```
 */
export function createGuardConfig(profile: GuardProfile): GuardConfig {
  const limits = PROFILE_LIMITS[profile];
  return { profile, limits, rateLimits: deriveRateLimits(limits) };
}
