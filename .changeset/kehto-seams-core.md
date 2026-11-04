---
"@kernl/core": minor
---

Adopt the host seams released in `@kehto/shell` 0.32.0, `@kehto/runtime` 0.28.0 and `@kehto/firewall` 0.7.0 (D-020).

- Port traffic is decided through `ShellAdapter.filterNappletMessage`. `GuardPipeline.observe` now returns kehto's `NappletMessageDecision` (`dispatch`, `defer` or `drop`). Breaking: `refuseCurrentDispatch` is removed, and what the guard will not let through is dropped with no reply instead of refused with a `firewall:` error.
- A hidden window's non-control requests are held and released with `ShellBridge.releaseDeferred` when it becomes visible (`GuardPipelineOptions.onRelease`), instead of refused. The `deferred-overflow` revocation removes the frame like every other reason.
- The adapter sets `aclDefaultPolicy: 'restrictive'`; `KernlGrants.ensure` grants what the record needs and revokes only what the stored entry holds beyond it.
- Breaking: `ShellAdapterDeps` replaces `onNappletMessage` with `filterNappletMessage`, `getFocusContext` and `runtimeFirewall`.
- New `applyRuntimeFirewallProfile`, `createRuntimeFirewallHooks`, `toGuardEvent` and `RUNTIME_FIREWALL_STORAGE_KEY`: the runtime firewall gets the profile's unfocused multiplier and startup burst on boot and on every profile change, open windows get the new rates, runtime refusals become guard events without the applet's message, and the runtime firewall's configuration is kept at `kernl:firewall:v1`.
- Requires `@kehto/services` ^0.30.1, `@napplet/core` >=0.38.0 <0.39.0 and `@napplet/nap` >=0.37.0 <0.38.0.
