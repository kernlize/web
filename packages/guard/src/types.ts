import type { FirewallConfig, EvaluateResult } from '@kehto/firewall';

/**
 * How much an applet is allowed to do before the guard intervenes.
 *
 * `strict` is the shell default. Profiles only change limits and thresholds;
 * every mitigation stays enabled in every profile.
 */
export type GuardProfile = 'strict' | 'balanced' | 'relaxed';

/**
 * Operation class the guard assigns to an inbound applet envelope. kehto's
 * firewall treats the class as an opaque key; kernl gives it meaning.
 */
export type OpClass =
  | 'relay:subscribe'
  | 'relay:publish'
  | 'relay:publish:delete'
  | 'outbox:subscribe'
  | 'outbox:publish'
  | 'resource:bytes'
  | 'storage:write'
  | 'dm:send'
  | 'intent:invoke'
  | 'control'
  | 'generic';

/** Window visibility as the shell observes it. Never self-reported by the applet. */
export interface WindowVisibility {
  /** The applet's window is rendered on screen (not minimised, workspace active). */
  readonly visible: boolean;
  /** The applet's window holds keyboard focus. Implies `visible`. */
  readonly focused: boolean;
  /** Milliseconds since the window last gained focus, when known. */
  readonly msSinceFocusGain?: number;
}

/** A NAP envelope as the guard sees it: only the fields it classifies on. */
export interface GuardEnvelope {
  readonly type: string;
  readonly kind?: number;
  readonly size?: number;
}

/** What the guard decided about one envelope. */
export type GuardDisposition = 'pass' | 'defer' | 'reject' | 'quarantine';

/** Emitted for every disposition other than `pass`, and for `pass` with a flag. */
export interface GuardEvent {
  readonly disposition: GuardDisposition | 'flag';
  readonly windowId: string;
  readonly napplet: string;
  readonly opClass: OpClass;
  /** Stable, prefixed reason, for example `rate:relay:publish` or `flood:hidden`. */
  readonly reason: string;
  readonly at: number;
}

/** Numeric limits that a profile sets. */
export interface GuardLimits {
  /** Messages a window may send per second before queueing begins. */
  readonly ingressBurst: number;
  /** Maximum queued messages per window before further ones are rejected. */
  readonly ingressQueue: number;
  /** Messages per window, in one quarantine window, before the window is quarantined. */
  readonly quarantineThreshold: number;
  /** Resource requests a hidden window may make before it is quarantined. */
  readonly hiddenResourceAllowance: number;
  /** Deferred messages a hidden window may hold before further ones are rejected. */
  readonly deferQueue: number;
  /** Largest `resource.*` envelope in bytes. */
  readonly maxResourceEnvelopeBytes: number;
  /** Largest `relay.subscribe` / `outbox.subscribe` envelope in bytes. */
  readonly maxSubscribeEnvelopeBytes: number;
  /** Token-bucket capacity per op class per window. */
  readonly rates: Readonly<Record<OpClass, { capacity: number; windowMs: number }>>;
  /** Multiplier applied to rate capacities while a window is unfocused. */
  readonly unfocusedMultiplier: number;
}

/** A complete guard configuration: the profile, its limits and the derived kehto firewall config. */
export interface GuardConfig {
  readonly profile: GuardProfile;
  readonly limits: GuardLimits;
  readonly firewall: FirewallConfig;
}

/** Ingress guard: flood control in front of the kehto bridge. */
export interface IngressGuard {
  /** Decide what to do with one envelope from one window. */
  admit(windowId: string, napplet: string, envelope: GuardEnvelope, visibility: WindowVisibility): GuardDisposition;
  /** Return queued envelopes that may now be dispatched, up to the drain batch size. */
  drain(windowId: string): readonly GuardEnvelope[];
  /** True once a window has been quarantined. Quarantine lasts until `release`. */
  isQuarantined(windowId: string): boolean;
  /** Lift quarantine and clear counters for a window; used when the user intervenes. */
  release(windowId: string): void;
  /** Drop all state for a window; call on revocation. */
  forget(windowId: string): void;
}

/** Visibility gate: defers traffic for hidden windows and drains it on return. */
export interface VisibilityGate {
  setVisibility(windowId: string, visibility: WindowVisibility): void;
  getVisibility(windowId: string): WindowVisibility;
  /** True when envelopes of this class should wait until the window is visible. */
  shouldDefer(windowId: string, opClass: OpClass): boolean;
  /** Queue an envelope; returns false when the defer queue is full. */
  defer(windowId: string, envelope: GuardEnvelope): boolean;
  /** Return every deferred envelope for a window, oldest first, and clear the queue. */
  drain(windowId: string): readonly GuardEnvelope[];
  forget(windowId: string): void;
}

/** Focus-aware firewall over the pure kehto engine. */
export interface FocusFirewall {
  /** Evaluate one envelope. Focus comes from the shell, never from the applet. */
  observe(windowId: string, napplet: string, envelope: GuardEnvelope, visibility: WindowVisibility): EvaluateResult;
  /** Reset counters for a window; call on revocation. */
  forget(windowId: string): void;
}

/** A mitigation the guard applies, described for the user. */
export interface MitigationDescription {
  readonly id: string;
  /** Short user-facing name. No protocol vocabulary. */
  readonly title: string;
  /** One or two sentences on what it protects against. */
  readonly summary: string;
  /** Whether the current profile has it on. Always true in this draft; kept for the UI contract. */
  readonly enabled: boolean;
  /** The limit that applies in the current profile, when the mitigation has one. */
  readonly limit?: string;
  /** Where it lives: in kehto, in kernl, or in both. */
  readonly provider: 'kehto' | 'kernl' | 'both';
}
