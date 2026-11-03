import { classifyEnvelope } from './classify.js';
import type {
  GuardConfig,
  GuardDisposition,
  GuardEnvelope,
  GuardEvent,
  GuardLimits,
  IngressGuard,
  OpClass,
  WindowVisibility,
} from './types.js';

/** Options for {@link createIngressGuard}. */
export interface IngressGuardOptions {
  readonly config: GuardConfig;
  /** Time source; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Receives an event for every disposition other than `pass`. */
  readonly onEvent?: (event: GuardEvent) => void;
  /** Most queued envelopes one `drain` call releases. Defaults to 4. */
  readonly drainBatch?: number;
}

/** Messages per window are counted over this rolling window for quarantine. */
export const QUARANTINE_WINDOW_MS = 10_000;

const BURST_WINDOW_MS = 1000;
const DEFAULT_DRAIN_BATCH = 4;

interface Queued {
  readonly envelope: GuardEnvelope;
  readonly opClass: OpClass;
  readonly seq: number;
}

interface WindowState {
  tokens: number;
  lastRefill: number;
  queue: Queued[];
  /** Arrival times inside the rolling quarantine window. */
  arrivals: number[];
  hiddenResourceCount: number;
  quarantined: boolean;
  seq: number;
}

interface Admission {
  readonly windowId: string;
  readonly napplet: string;
  readonly envelope: GuardEnvelope;
  readonly opClass: OpClass;
  readonly visibility: WindowVisibility;
  readonly at: number;
}

/** Drain order: keep windows controllable, then feed what the user is looking at. */
const DRAIN_RANK: Readonly<Partial<Record<OpClass, number>>> = { control: 0, 'resource:bytes': 1 };

function rank(opClass: OpClass): number {
  return DRAIN_RANK[opClass] ?? 2;
}

function sizeCap(limits: GuardLimits, opClass: OpClass): number | undefined {
  if (opClass === 'resource:bytes') return limits.maxResourceEnvelopeBytes;
  if (opClass === 'relay:subscribe' || opClass === 'outbox:subscribe') return limits.maxSubscribeEnvelopeBytes;
  return undefined;
}

function freshWindow(at: number, limits: GuardLimits): WindowState {
  return {
    tokens: limits.ingressBurst,
    lastRefill: at,
    queue: [],
    arrivals: [],
    hiddenResourceCount: 0,
    quarantined: false,
    seq: 0,
  };
}

function refill(state: WindowState, limits: GuardLimits, at: number): void {
  const elapsed = Math.max(0, at - state.lastRefill);
  state.tokens = Math.min(limits.ingressBurst, state.tokens + (elapsed * limits.ingressBurst) / BURST_WINDOW_MS);
  state.lastRefill = at;
}

/**
 * Create the flood control that sits in front of the kehto bridge.
 *
 * Each window has a token bucket of `ingressBurst` per second. When it is
 * empty, envelopes queue (`defer`) up to `ingressQueue` and are released by
 * `drain` as tokens refill; past the queue they are rejected. A window that
 * sends `quarantineThreshold` messages inside ten seconds, or fetches more
 * than `hiddenResourceAllowance` resources while hidden, is quarantined until
 * the user releases it. Oversized envelopes are rejected outright.
 *
 * The guard emits an event for every disposition other than `pass`, so the
 * user can see what an applet tried to do (D-003).
 *
 * @param options - Configuration, time source, event sink and drain batch size.
 * @returns An ingress guard tracking many windows.
 * @example
 * ```ts
 * const guard = createIngressGuard({ config: createGuardConfig('strict') });
 * guard.admit('w1', 'chat', { type: 'relay.subscribe' }, { visible: true, focused: true }); // 'pass'
 * ```
 */
export function createIngressGuard(options: IngressGuardOptions): IngressGuard {
  const { limits } = options.config;
  const now = options.now ?? Date.now;
  const onEvent = options.onEvent ?? (() => undefined);
  const drainBatch = options.drainBatch ?? DEFAULT_DRAIN_BATCH;
  const windows = new Map<string, WindowState>();

  function window(windowId: string, at: number): WindowState {
    const existing = windows.get(windowId);
    if (existing) return existing;
    const created = freshWindow(at, limits);
    windows.set(windowId, created);
    return created;
  }

  function settle(admission: Admission, disposition: Exclude<GuardDisposition, 'pass'>, reason: string): GuardDisposition {
    const { windowId, napplet, opClass, at } = admission;
    onEvent({ disposition, windowId, napplet, opClass, reason, at });
    return disposition;
  }

  function quarantine(state: WindowState, admission: Admission, reason: string): GuardDisposition {
    state.quarantined = true;
    state.queue = [];
    return settle(admission, 'quarantine', reason);
  }

  function trackHiddenResources(state: WindowState, admission: Admission): boolean {
    if (admission.visibility.visible) {
      state.hiddenResourceCount = 0;
      return false;
    }
    if (admission.opClass !== 'resource:bytes') return false;
    state.hiddenResourceCount += 1;
    return state.hiddenResourceCount > limits.hiddenResourceAllowance;
  }

  function enqueue(state: WindowState, admission: Admission): GuardDisposition {
    if (state.queue.length >= limits.ingressQueue) return settle(admission, 'reject', 'flood:queue-full');
    state.seq += 1;
    state.queue.push({ envelope: admission.envelope, opClass: admission.opClass, seq: state.seq });
    return settle(admission, 'defer', 'flood:burst');
  }

  function decide(state: WindowState, admission: Admission): GuardDisposition {
    const { at, opClass, envelope } = admission;
    state.arrivals = state.arrivals.filter((t) => at - t < QUARANTINE_WINDOW_MS);
    state.arrivals.push(at);
    if (state.arrivals.length >= limits.quarantineThreshold) return quarantine(state, admission, 'flood:quarantine');
    if (trackHiddenResources(state, admission)) return quarantine(state, admission, 'flood:hidden-resource');

    const cap = sizeCap(limits, opClass);
    if (cap !== undefined && envelope.size !== undefined && envelope.size > cap) {
      return settle(admission, 'reject', `size:${opClass}`);
    }

    refill(state, limits, at);
    // Nothing overtakes the queue: a new envelope joins it while older ones wait.
    if (state.queue.length > 0 || state.tokens < 1) return enqueue(state, admission);
    state.tokens -= 1;
    return 'pass';
  }

  return {
    admit(windowId, napplet, envelope, visibility) {
      const at = now();
      const state = window(windowId, at);
      const admission: Admission = { windowId, napplet, envelope, opClass: classifyEnvelope(envelope), visibility, at };
      if (state.quarantined) return settle(admission, 'quarantine', 'flood:quarantine');
      return decide(state, admission);
    },
    drain(windowId) {
      const state = windows.get(windowId);
      if (!state) return [];
      refill(state, limits, now());
      const count = Math.min(drainBatch, Math.floor(state.tokens), state.queue.length);
      const released = [...state.queue].sort((a, b) => rank(a.opClass) - rank(b.opClass) || a.seq - b.seq).slice(0, count);
      state.queue = state.queue.filter((item) => !released.includes(item));
      state.tokens -= released.length;
      return released.map((item) => item.envelope);
    },
    isQuarantined(windowId) {
      return windows.get(windowId)?.quarantined ?? false;
    },
    release(windowId) {
      windows.set(windowId, freshWindow(now(), limits));
    },
    forget(windowId) {
      windows.delete(windowId);
    },
  };
}
