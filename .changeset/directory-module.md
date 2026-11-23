---
'@kernlize/core': minor
---

The relay directory is a module, `directoryModule()`, in `kernlModules()`. A host that names its own modules gets `Kernel & ModuleApis<M>`: `kernl.directory` is there only when the directory module is loaded. Without it, an account with no relay list is offered the well-known servers. `createKernlNetwork` no longer builds the directory; it takes a `directory` accessor for the mailboxes' suggestions instead, and `KernlNetwork` has no `directory`.
