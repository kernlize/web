---
'@kernlize/core': patch
---

The kernel moves into its own package, `@kernlize/kernel` (D-068), and `@kernlize/core` re-exports it, so every name core exported is still there. `@kernlize/core/crypto`, `@kernlize/core/seal` and `@kernlize/core/asks` re-export the kernel's entries of the same names. `asFilters` and `bindingMethod` are now exported too.
