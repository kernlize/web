---
'@kernlize/core': minor
---

Profiles and people are modules, `profilesModule()` and `peopleModule()`, in `kernlModules()` before the social module, which requires them. Without the profiles module the session is labelled by the start of its key; without the people module an applet's recipients are taken as hex keys only. `KernelContext` gains `replaceableLoader`; `KERNEL_PARTS` and `checkModules`' second parameter are gone, and `KernlNetwork` has no `profiles` or `people`.
