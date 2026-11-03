# Change the guard profile

The shell boots every applet in `strict`. A user can loosen one applet to `balanced` or `relaxed`. There is no way to loosen every applet at once, and that is the point (D-003).

## In the shell

1. Open the applet's grants panel from its window title bar.
2. Under *Guard*, pick `balanced` or `relaxed`. The list of mitigations updates to show the new limit for each one. The CSP row does not change; it never does.
3. The change applies to the applet's current window immediately and is remembered for this identity `(dTag, hash)` on this device. A new build of the applet starts in `strict` again and tells you the previous override no longer applies.

Pick `strict` again at any time. Quarantine, if the applet was in it, is lifted when you change profile, because changing profile is the user intervening.

## In code

The shell holds one guard instance per window, built from a `GuardConfig`. `@kernl/guard` exports the three configs as `profiles` and a factory for each guard layer:

```ts
import { createFocusFirewall, createIngressGuard, createVisibilityGate, profiles } from '@kernl/guard';

function guardFor(profile: 'strict' | 'balanced' | 'relaxed') {
  const config = profiles[profile];
  return {
    config,
    ingress: createIngressGuard(config, { now: () => performance.now() }),
    gate: createVisibilityGate(config),
    firewall: createFocusFirewall(config, { now: () => Date.now() }),
  };
}
```

`@kernl/core` wraps this in `planMount`, which reads the stored override for the identity and falls back to `strict`. To change the profile for a mounted window, the shell calls the window's `setProfile(profile)`, which:

1. replaces the three guard layers with ones built from the new config,
2. calls `release(windowId)` on the old ingress guard so quarantine does not survive the change,
3. tightens or relaxes kehto's own firewall through `bridge.runtime.firewallState` with the new `FirewallConfig`,
4. persists `{ identity, profile }` through core's persistence and emits a `GuardEvent` with reason `profile:<name>` so the change is visible in the log.

## What a profile cannot change

- The Content Security Policy. `cspProfile()` returns one policy regardless of profile; see [why](../concepts/guard.md#why-csp-never-loosens).
- Whether a mitigation is enabled. Every profile enables all eleven.
- Grants. A profile is about rate, not authority. [Grant and revoke](./grant-and-revoke.md) covers authority.

## Adding a profile

Do not. Three is the number the UI was designed around, and a fourth profile would be a developer deciding how much an applet may do, which `SOUL.md` reserves for the user. If an applet needs a limit no profile provides, that is a reason to revisit the limits in `strict`, with a scenario in `features/` that shows the applet a competent developer could not otherwise build.
