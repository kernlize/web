---
'@kernlize/core': minor
---

`@kernlize/core` is deprecated (D-068). `createKernl`, `kernlModules` and the `Kernl` types move into `@kernlize/preset`, which is now public, and core re-exports the kernel, the modules and the preset, so every name it exported is still there. Import from `@kernlize/kernel`, `@kernlize/modules` and `@kernlize/preset` instead; core goes one minor from now.
