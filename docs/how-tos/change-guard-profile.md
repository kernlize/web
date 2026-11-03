# Change the guard profile

The shell boots in `strict`. In this draft a user can switch the whole shell to `balanced` or `relaxed`; the choice applies to every window and is not remembered, so every boot starts in `strict` again. Loosening one applet at a time, remembered, is what [D-003](../decisions.md#d-003) asks for and is planned ([Roadmap](../roadmap.md#_6-guard)). No developer flag or configuration file loosens the guard.

## In the shell

1. Open the guard panel from the desktop bar (*Guard · strict · N*).
2. Under *Profile*, pick `balanced` or `relaxed`. The list of mitigations updates to show the new limit for each one. The CSP does not change; it never does.
3. The change calls `kernl.guard.setProfile(profile)`, which rebuilds every guard layer for every open window at once; held messages are dropped and counters restart, so a quarantined window is released. It is not persisted: a reload starts in `strict` again.

The per-applet, remembered override that [D-003](../decisions.md#d-003) describes is listed under [Alpha status](../alpha-status.md#what-does-not-work-yet).

## In code

A profile is a `GuardConfig` from `createGuardConfig(profile)`. The three guard layers each take that config in an options object, together with an optional clock and an event sink:

```ts
import {
  createFocusFirewall,
  createGuardConfig,
  createIngressGuard,
  createVisibilityGate,
  type GuardEvent,
  type GuardProfile,
} from '@kernl/guard';

function guardFor(profile: GuardProfile, onEvent: (event: GuardEvent) => void) {
  const config = createGuardConfig(profile);
  return {
    config,
    ingress: createIngressGuard({ config, onEvent }),
    gate: createVisibilityGate({ config, onEvent }),
    firewall: createFocusFirewall({ config, onEvent }),
  };
}
```

`now` defaults to `Date.now` in all three; inject it in tests. Switching a mounted window from one profile to another means, at the guard level:

1. Build the three layers from the new config. The layers hold no reference to the profile, so there is no in-place update; the old `IngressGuard`, `VisibilityGate` and `FocusFirewall` are replaced.
2. Drain what the old gate and old ingress guard still hold (`drain(windowId)`) and admit it through the new layers, so nothing queued is lost.
3. Call `release(windowId)` on the old ingress guard, or simply drop it: quarantine lives in the guard instance and does not survive the swap.
4. If the shell also runs kehto's runtime firewall from `config.firewall`, hand it the new `FirewallConfig`. Per-applet rates are not in a fresh config; `applyNappletRules(config, dTag)` adds them, and the focus firewall does this itself on first observation.

`@kernl/core` does this inside `createGuardPipeline`: `GuardFacade.setProfile(profile)` rebuilds the three layers from `createGuardConfig(profile)`, clears what they held, re-applies the known visibility of every window and emits on `profile$`; `GuardFacade.release(windowId)` lifts a quarantine on its own. Applets mounted after the change get the new profile's rates in kehto's runtime firewall through `applyRuntimeFirewallRules`; windows already open keep the runtime rates they were mounted with until they are opened again. The [core page](../packages/core.md#the-kernl-surface) documents that surface.

## What a profile cannot change

- The Content Security Policy. `createAppletCsp(profile)` returns the same policy for every profile; see [why](../concepts/guard.md#why-csp-never-loosens) and `csp.feature`, scenario "the relaxed profile does not loosen the CSP".
- Whether a mitigation is enabled. Every profile enables all eleven; `describeMitigations(config)` only changes the `limit` text.
- Grants. A profile is about rate, not authority. [Grant and revoke](./grant-and-revoke.md) covers authority.

## What a profile changes

Exact values for every limit and every per-class rate are in [Guard](../concepts/guard.md#profiles). In one line each: `balanced` raises the headline limits by 1.5× to 2× (`ingressBurst` 8 → 12, `ingressQueue` 64 → 128, `quarantineThreshold` 300 → 420, `hiddenResourceAllowance` 8 → 16, `deferQueue` 200 → 400, envelope caps 64/256 KiB → 128/512 KiB, `unfocusedMultiplier` 0.25 → 0.5) and doubles every rate; `relaxed` goes to 24, 192, 800, 32, 600, 192/768 KiB and 0.75, and triples every rate.

## Adding a profile

Do not. Three is the number the UI was designed around, and a fourth profile would be a developer deciding how much an applet may do, which `SOUL.md` reserves for the user. If an applet needs a limit no profile provides, that is a reason to revisit the limits in `strict`, with a scenario in `packages/guard/features/profiles.feature` that shows the applet a competent developer could not otherwise build.
