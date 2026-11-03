import {
  addMatcher,
  defaultConfig,
  setGlobalRate,
  setRateLimit,
  type FirewallConfig,
  type RateLimit,
} from '@kehto/firewall';
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

/** Exceed action for every rate kernl registers. kehto's own default is `flag`. */
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

function toRateLimit(rate: { capacity: number; windowMs: number }): RateLimit {
  return { capacity: rate.capacity, windowMs: rate.windowMs, action: RATE_EXCEED_ACTION };
}

/**
 * Derive the kehto firewall config for a set of limits.
 *
 * kehto keys per-class rate limits by applet, so a fresh config can only carry
 * the class-independent parts: `defaultRate` (the `generic` class), the content
 * matchers that block oversized envelopes, the init-burst guard and the
 * unfocused multiplier. Per-class rates are registered per applet by
 * {@link applyNappletRules}.
 */
function deriveFirewall(limits: GuardLimits): FirewallConfig {
  let firewall: FirewallConfig = {
    ...defaultConfig(),
    defaultRate: toRateLimit(limits.rates.generic),
    burstGuard: { windowMs: 1000, maxOps: limits.ingressBurst, action: 'block' },
    unfocusedMultiplier: limits.unfocusedMultiplier,
  };
  // kehto matchers fire on `size >= minSize`; the limits are inclusive maxima.
  firewall = addMatcher(firewall, {
    id: 'size:resource:bytes',
    opClass: 'resource:bytes',
    minSize: limits.maxResourceEnvelopeBytes + 1,
    action: 'block',
  });
  for (const opClass of ['relay:subscribe', 'outbox:subscribe'] as const) {
    firewall = addMatcher(firewall, {
      id: `size:${opClass}`,
      opClass,
      minSize: limits.maxSubscribeEnvelopeBytes + 1,
      action: 'block',
    });
  }
  return firewall;
}

/**
 * Build the complete guard configuration for a profile.
 *
 * The `firewall` field is kehto's `defaultConfig()` tightened to the profile.
 * What each layer enforces:
 *
 * - The kehto engine (`evaluate`) enforces the content matchers, the per-applet
 *   rates registered by {@link applyNappletRules}, the `generic` default rate
 *   and the unfocused multiplier. Its init-burst guard only fires for callers
 *   that supply `initElapsedMs`; kernl's focus firewall does not, so inside
 *   kernl the per-second burst is enforced by the ingress guard, and the
 *   `burstGuard` field exists so a runtime firewall configured from this
 *   object agrees with it.
 * - The ingress guard enforces `ingressBurst`, `ingressQueue`,
 *   `quarantineThreshold`, `hiddenResourceAllowance` and the envelope size caps.
 * - The visibility gate enforces `deferQueue`.
 *
 * @param profile - Which profile to build.
 * @returns The profile's limits and derived firewall config.
 * @example
 * ```ts
 * const config = createGuardConfig('strict');
 * config.limits.ingressBurst; // 8
 * config.firewall.unfocusedMultiplier; // 0.25
 * ```
 */
export function createGuardConfig(profile: GuardProfile): GuardConfig {
  const limits = PROFILE_LIMITS[profile];
  return { profile, limits, firewall: deriveFirewall(limits) };
}

/**
 * Register the profile's per-class rates for one applet in the kehto firewall.
 *
 * kehto's `rateLimits` map is keyed by applet identity, so class rates cannot
 * live in a fresh config. The focus firewall calls this lazily on the first
 * observation of an applet; core may call it earlier, when a window binds, so
 * that a user's per-applet policy and the rates land in one config. Existing
 * policy and matchers are preserved; rates for the applet are overwritten.
 *
 * @param config - Current guard configuration.
 * @param napplet - Applet identity (dTag) to register rules for.
 * @returns A new guard configuration; the input is not modified.
 * @example
 * ```ts
 * const bound = applyNappletRules(createGuardConfig('strict'), 'chat');
 * bound.firewall.napplets.chat?.rateLimits['relay:publish']?.capacity; // 20
 * ```
 */
export function applyNappletRules(config: GuardConfig, napplet: string): GuardConfig {
  let firewall = config.firewall;
  for (const [opClass, rate] of Object.entries(config.limits.rates)) {
    firewall = setRateLimit(firewall, napplet, opClass, toRateLimit(rate));
  }
  firewall = setGlobalRate(firewall, napplet, toRateLimit(config.limits.rates.generic));
  return { ...config, firewall };
}
