---
'@kernlize/core': patch
---

kernl's modules move into their own package, `@kernlize/modules` (D-068), and `@kernlize/core` re-exports it, so every name core exported is still there. `@kernlize/core/wm`, `@kernlize/core/cache`, `@kernlize/core/messaging/ratchet` and `@kernlize/core/messaging/groups` re-export the modules' entries of the same names.
