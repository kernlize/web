---
"@kernlize/guard": patch
---

Depend on `@kehto/firewall` ^0.7.0 and accept `@napplet/core` 0.38. The `hidden-deferral` mitigation now says a hidden applet's requests are held until it is visible, and `focus-tightening` is provided by both kehto and kernl, because the runtime firewall applies the unfocused multiplier too (D-020).
