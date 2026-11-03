# @kernl/guard

Ingress flood control, visibility gating, focus-aware firewall and CSP profile for the kernl shell. Pure: no DOM, no timers, no wall clock. Time is injected.

| Field | Value |
| --- | --- |
| Package | `@kernl/guard` |
| Version | `0.1.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | `@kehto/firewall ^0.6.3` |
| Peer dependencies | `@napplet/core >=0.37.0 <0.38.0` |
| Side effects | none |

## Install

```bash
pnpm add @kernl/guard
```

## Purpose

The guard is the set of protections between an applet and the user. kehto's `@kehto/firewall` supplies a pure `evaluate()` engine; this package gives its opaque operation classes meaning, adds the layers kehto's `ShellAdapter` cannot yet host (ingress flood control, the visibility gate, focus supplied by the shell's window manager), fixes the CSP, and describes every mitigation for the UI. The concepts are in [Guard](../concepts/guard.md).

## Main exports

| Export | Kind | Role |
| --- | --- | --- |
| `GuardProfile` | type | `'strict' \| 'balanced' \| 'relaxed'` |
| `GuardLimits`, `GuardConfig` | type | The numeric limits a profile sets, and a profile plus its derived `FirewallConfig` |
| `profiles` | const | The three `GuardConfig` values; the shell boots in `profiles.strict` |
| `OpClass` | type | The eleven operation classes the guard assigns to inbound envelopes |
| `classify(envelope)` | function | Maps a `GuardEnvelope` to an `OpClass` |
| `GuardEnvelope`, `WindowVisibility` | type | The fields the guard classifies on, and visibility as the shell observes it |
| `IngressGuard`, `createIngressGuard(config, clock)` | interface, factory | `admit`, `drain`, `isQuarantined`, `release`, `forget` |
| `VisibilityGate`, `createVisibilityGate(config)` | interface, factory | `setVisibility`, `getVisibility`, `shouldDefer`, `defer`, `drain`, `forget` |
| `FocusFirewall`, `createFocusFirewall(config, clock)` | interface, factory | `observe` over kehto's `evaluate()`, `forget` |
| `GuardDisposition`, `GuardEvent` | type | `pass`, `defer`, `reject`, `quarantine`; the event emitted for every non-pass and every flag |
| `cspProfile()` | function | The one Content Security Policy, as `NappletCspOptions` for `prepareNappletSrcdoc` |
| `MitigationDescription`, `describeMitigations(config)` | type, function | The eleven mitigations with the limit that applies in `config` |

## Scope

- Pure functions and small stateful objects keyed by `windowId`. Call `forget(windowId)` on every revocation.
- Does not parse NAP envelopes beyond `type`, `kind` and `size`; the shell passes those fields.
- Does not decide grants. Whether a domain is allowed is `@kehto/acl`'s question, surfaced through `@kernl/core`.
- Does not touch the DOM or the iframe. The shell applies `cspProfile()` through kehto's `prepareNappletSrcdoc`.

## API reference

Generated module: [`_kernl_guard`](/api/modules/_kernl_guard.html){target="_self"}
