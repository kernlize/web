---
'@kernlize/core': minor
---

The event cache is a module, `cacheModule(open)`, in `kernlModules({ eventCache })`; `KernlOptions.eventCache` still reaches it when a host names no modules. Without the module the shell keeps events in memory only. `createKernlNetwork` takes only its parts, with an optional `cacheRequest`, and `KernlNetwork` has no `eventCache`.
