# @kernlize/guard

Ingress flood control, visibility gating, focus-aware firewall, CSP profile and nested-frame insertion lock for the kernl shell. Pure: no DOM, no timers. Every factory takes an optional `now` clock and defaults to `Date.now`.

| Field | Value |
| --- | --- |
| npm | `@kernlize/guard` |
| JSR | `@kernl/guard` |
| Version | `0.1.1` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | `@kehto/firewall ^0.7.0` |
| Peer dependencies | `@napplet/core >=0.37.0 <0.39.0` |
| Side effects | none |

## Install

This package is `@kernlize/guard` on npm and `@kernl/guard` on JSR, the same code at the same version. Once released:

```sh
npm install @kernlize/guard
# or
deno add jsr:@kernl/guard
```

Neither registry has a release yet, so both commands fail. During the alpha the package is built from the kernl source repository, which is private, and consumed as a workspace dependency under its npm name. The [package index](./index.md#install) has the steps.

```json
{ "dependencies": { "@kernlize/guard": "workspace:^" } }
```

## Purpose

The guard is the set of protections between an applet and the user. kehto's `@kehto/firewall` supplies a pure `evaluate()` engine; this package gives its opaque operation classes meaning, adds the layers kehto's `ShellAdapter` cannot yet host (ingress flood control, the visibility gate, focus supplied by the shell's window manager), fixes the CSP, adds an insertion lock on top of kehto's nested-context lock ([D-014](../decisions.md#d-014)), and describes every mitigation for the UI. The concepts and the numbers are in [Guard](../concepts/guard.md).

## Exports

### Profiles and configuration

| Export | Signature | Description |
| --- | --- | --- |
| `GUARD_PROFILES` | `readonly GuardProfile[]` | `['strict', 'balanced', 'relaxed']`, tightest first. `strict` is the shell default ([D-003](../decisions.md#d-003)). |
| `createGuardConfig` | `(profile: GuardProfile) => GuardConfig` | The profile's `GuardLimits` plus the derived kehto `FirewallConfig`: `defaultRate` from the `generic` class, `burstGuard` from `ingressBurst`, `unfocusedMultiplier`, and three `block` content matchers (`size:resource:bytes`, `size:relay:subscribe`, `size:outbox:subscribe`) at `cap + 1` bytes. No per-applet rules. |
| `applyNappletRules` | `(config: GuardConfig, napplet: string) => GuardConfig` | Returns a new config whose firewall carries every class rate as a per-applet `rateLimits` entry plus a `globalRate` equal to the `generic` rate, all with action `block`. Existing policy and matchers are kept; rates for the applet are overwritten. The input is not modified. |
| `GuardProfile` | `'strict' \| 'balanced' \| 'relaxed'` | Profiles change limits only; every mitigation stays on in every profile. |
| `GuardLimits` | interface | `ingressBurst`, `ingressQueue`, `quarantineThreshold`, `hiddenResourceAllowance`, `deferQueue`, `maxResourceEnvelopeBytes`, `maxSubscribeEnvelopeBytes`, `rates` (per `OpClass`: `{ capacity, windowMs }`), `unfocusedMultiplier`. |
| `GuardConfig` | interface | `{ profile, limits, firewall }`. |
| `AdmitOptions` | interface | `{ hold?: boolean }` for `IngressGuard.admit`; `hold: false` reports a burst as `defer` without queueing the envelope. |

### Classification

| Export | Signature | Description |
| --- | --- | --- |
| `classifyEnvelope` | `(envelope: GuardEnvelope) => OpClass` | Maps an envelope `type` (and `kind` for publishes) to one of the eleven classes. `relay.publish` with kind 5 is `relay:publish:delete`; unknown types are `generic`. The full map is in [Guard](../concepts/guard.md#operation-classes). |
| `estimateEnvelopeSize` | `(value: unknown) => number` | UTF-8 byte length of `JSON.stringify(value)`; `0` when the value cannot be serialised. Use it to fill `GuardEnvelope.size`. |
| `OpClass` | union | `relay:subscribe`, `relay:publish`, `relay:publish:delete`, `outbox:subscribe`, `outbox:publish`, `resource:bytes`, `storage:write`, `dm:send`, `intent:invoke`, `control`, `generic`. |
| `GuardEnvelope` | interface | `{ type: string; kind?: number; size?: number }`: the only fields the guard reads. |
| `WindowVisibility` | interface | `{ visible: boolean; focused: boolean; msSinceFocusGain?: number }` as observed by the shell, never self-reported. |

### Ingress guard

| Export | Signature | Description |
| --- | --- | --- |
| `createIngressGuard` | `(options: IngressGuardOptions) => IngressGuard` | Per-window token bucket of `ingressBurst` per second, a queue of `ingressQueue`, quarantine at `quarantineThreshold` arrivals in a rolling 10 s window or past `hiddenResourceAllowance` resource requests while hidden, and envelope size caps. |
| `IngressGuardOptions` | interface | `{ config: GuardConfig; now?: () => number; onEvent?: (event: GuardEvent) => void; drainBatch?: number }`. `drainBatch` defaults to 4. |
| `IngressGuard` | interface | `admit(windowId, napplet, envelope, visibility, options?: AdmitOptions): GuardDisposition` (`{ hold: false }` reports a `defer` without queueing the envelope), `drain(windowId): readonly GuardEnvelope[]`, `isQuarantined(windowId): boolean`, `release(windowId): void` (lifts quarantine, restores a fresh budget), `forget(windowId): void` (drops all state). |
| `QUARANTINE_WINDOW_MS` | `10_000` | The rolling window over which arrivals are counted against `quarantineThreshold`. |
| `GuardDisposition` | `'pass' \| 'defer' \| 'reject' \| 'quarantine'` | What `admit` returns. `defer` here means the burst budget is spent and the envelope was queued, not that the window is hidden. |
| `GuardEvent` | interface | `{ disposition: GuardDisposition \| 'flag'; windowId; napplet; opClass; reason; at }`. Emitted for every disposition other than `pass`, and for a `pass` the firewall flagged. `reason` is a stable prefixed string; the list is in [Guard](../concepts/guard.md#dispositions-and-reasons). |

### Visibility gate

| Export | Signature | Description |
| --- | --- | --- |
| `createVisibilityGate` | `(options: VisibilityGateOptions) => VisibilityGate` | Holds a hidden window's traffic (everything except `control`) in a queue of `deferQueue` and releases it, oldest first, when the window returns. |
| `VisibilityGateOptions` | interface | `{ config: GuardConfig; onEvent?; now?; nappletFor?: (windowId: string) => string }`. Without `nappletFor`, overflow events name the applet `unknown`. |
| `VisibilityGate` | interface | `setVisibility(windowId, visibility)`, `getVisibility(windowId)` (unreported windows are `{ visible: true, focused: false }`), `shouldDefer(windowId, opClass): boolean`, `defer(windowId, envelope): boolean` (`false` and a `reject` event with reason `defer:queue-full` when full), `drain(windowId)`, `forget(windowId)`. |

### Focus firewall

| Export | Signature | Description |
| --- | --- | --- |
| `createFocusFirewall` | `(options: FocusFirewallOptions) => FocusFirewall` | kehto's `evaluate()` fed with the shell's `focused` flag. Registers the applet's class rates through `applyNappletRules` on first observation. `reject` emits `reject`; `pass` with action `flag` emits `flag`; `prompt` emits `reject` with reason `prompt:<ruleId>`. |
| `FocusFirewallOptions` | interface | `{ config: GuardConfig; now?: () => number; onEvent?: (event: GuardEvent) => void }`. |
| `FocusFirewall` | interface | `observe(windowId, napplet, envelope, visibility): EvaluateResult` (kehto's result, with `newState` already applied), `forget(windowId): void`. kehto keys budgets by applet, so `forget` also resets the budget of another window running the same applet. |

### CSP

| Export | Signature | Description |
| --- | --- | --- |
| `createAppletCsp` | `(profile: GuardProfile) => AppletCsp` | kehto's zero-network baseline: 14 directives, `connect-src 'none'`, no connection origins. The Trusted Types directives are not part of it; kehto adds them itself when `planMount` enables `experimental.nestedContextLock`. The profile argument is accepted and ignored; see [why CSP never loosens](../concepts/guard.md#why-csp-never-loosens). |
| `renderCsp` | `(directives: Readonly<Record<string, readonly string[]>>) => string` | `"default-src 'none'; img-src data: blob:"`-style policy string for a `Content-Security-Policy` meta tag. |
| `AppletCsp` | interface | `{ connectOrigins: readonly string[]; directives: Readonly<Record<string, readonly string[]>> }`, structurally compatible with kehto's `NappletCspOptions`. |

### Insertion lock

kernl's addition to kehto's `experimental.nestedContextLock` (`@kehto/shell` 0.30.0). kehto's lock guards frame creation; this one guards insertion, for the creation routes kehto's lock does not see ([D-014](../decisions.md#d-014)).

| Export | Signature | Description |
| --- | --- | --- |
| `renderInsertionLockScript` | `() => string` | An inline `<script data-kernl-insertion-lock>` that, run in the applet realm, applies `appletInsertionLock`: it pins `appendChild`, `insertBefore`, `replaceChild`, `append`, `prepend`, `replaceChildren`, `before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `Range.insertNode` and `Range.surroundContents` to throw `TypeError('denied:nested-frame')` for any node that is, or contains (descendants, template content, shadow roots), an HTML-namespace frame element, reading node identity through native getters captured before applet code runs. It also refuses custom elements that extend frame elements and removes `XSLTProcessor`. Insert it immediately after kehto's namespace prelude; `planMount` does. A pre-frozen prototype is skipped rather than blocking the load. |

Removed in favour of kehto's released lock: `appletMarkupHasFrame`, `assertAppletHasNoFrame`, `renderFrameLockScript` (renamed `renderInsertionLockScript`, now without the Trusted Types policy and factory pins), `TRUSTED_TYPES_DIRECTIVES`, and `AppletCsp.trustedTypes`.

### Mitigation descriptions

| Export | Signature | Description |
| --- | --- | --- |
| `describeMitigations` | `(config: GuardConfig) => readonly MitigationDescription[]` | The eleven mitigations in display order, with `limit` text computed from `config.limits`. Titles and summaries name no protocol. The table is in [Guard](../concepts/guard.md#the-eleven-mitigations). |
| `MitigationDescription` | interface | `{ id; title; summary; enabled: boolean; limit?: string; provider: 'kehto' \| 'kernl' \| 'both' }`. `enabled` is always `true` in this draft. |

## Example

```ts
import { applyNappletRules, createGuardConfig, createIngressGuard, describeMitigations } from '@kernlize/guard';

const config = createGuardConfig('strict');
config.limits.ingressBurst; // 8
config.firewall.unfocusedMultiplier; // 0.25

const bound = applyNappletRules(config, 'chat');
bound.firewall.napplets['chat']?.rateLimits['relay:publish']?.capacity; // 20

const guard = createIngressGuard({ config, onEvent: (event) => console.log(event.reason) });
guard.admit('w1', 'chat', { type: 'relay.subscribe' }, { visible: true, focused: true }); // 'pass'

describeMitigations(config).find((m) => m.id === 'ingress-flood')?.limit; // '8 messages per second, 300 per 10s'
```

## Scope

- Pure functions and small stateful objects keyed by `windowId`. Call `forget(windowId)` on every revocation.
- Does not parse NAP envelopes beyond `type`, `kind` and `size`; the shell passes those fields and may use `estimateEnvelopeSize` for the third.
- Does not decide grants. Whether a domain is allowed is `@kehto/acl`'s question, surfaced through `@kernlize/core`.
- Does not touch the shell's DOM or the iframe. The shell applies `createAppletCsp(profile)` through kehto's `prepareNappletSrcdoc`, with kehto's nested-context lock enabled, and `planMount` in `@kernlize/core` inserts the insertion lock's script, which runs only inside the applet realm.
- Does not carry the Trusted Types policy, the element-factory pins or the static frame scan. Those are kehto's (`experimental.nestedContextLock`, `assertNappletHasNoFrame`).
- Does not supply `initElapsedMs` to kehto, so `GuardConfig.firewall.burstGuard` never fires inside this package. `@kernlize/core` installs it, with `unfocusedMultiplier`, in kehto's runtime firewall, which supplies `initElapsedMs` and focus, so the profile's startup burst applies there ([Guard](../concepts/guard.md#layers)).

## Specification

`packages/guard/features/`: `profiles.feature`, `classification.feature`, `ingress.feature`, `visibility.feature`, `focus-firewall.feature`, `csp.feature`, `insertion-lock.feature`, `mitigations.feature`.

## API reference

Generated module: [`_kernlize_guard`](../api/modules/_kernlize_guard.html){target="_self"}
