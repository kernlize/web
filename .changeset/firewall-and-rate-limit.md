---
'@kernlize/guard': minor
'@kernlize/core': minor
---

kehto's firewall is now an approval authority and its temporal engine moved to `@kehto/rate-limit`; kernl adopts both (D-050).

`@kernlize/guard`: `createFocusFirewall` is `createFocusRateLimiter`, over `@kehto/rate-limit`'s `evaluateRateLimit` with one budget per operation class in `GuardConfig.rateLimits`. `applyNappletRules`, `GuardConfig.firewall` and the legacy engine are gone. A `firewall` mitigation is described.

`@kernlize/core`: the shell configures kehto's `permissions`. Every applet is admitted by the firewall in `plan`, and every request is put to it. `defaultFirewallRules` allows what the person granted and asks about every link. `Kernl.firewall` sets rules and takes answers back; `KernlHost.presentApproval` shows a question; `KernlHost.openLink` is told when a link was already approved. `createRuntimeRateLimiter` replaces the legacy rate gate, and the `runtime-rules` exports are removed.
