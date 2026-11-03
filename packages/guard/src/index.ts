/**
 * The guard: every protection kernl places between an applet and the user.
 *
 * Flood control, visibility deferral and the focus-aware firewall run in
 * front of the kehto bridge (D-001); the CSP and mitigation descriptions feed
 * the mount plan and the grants panel (D-003).
 *
 * @packageDocumentation
 */
export { classifyEnvelope, estimateEnvelopeSize } from './classify.js';
export { createAppletCsp, renderCsp, type AppletCsp } from './csp.js';
export { createFocusFirewall, type FocusFirewallOptions } from './focus-firewall.js';
export { createIngressGuard, QUARANTINE_WINDOW_MS, type IngressGuardOptions } from './ingress-guard.js';
export { describeMitigations } from './mitigations.js';
export { applyNappletRules, createGuardConfig, GUARD_PROFILES } from './profiles.js';
export { createVisibilityGate, type VisibilityGateOptions } from './visibility-gate.js';
export type * from './types.js';
