---
'@kernlize/core': minor
---

The download programs and the `torrent`, `nzb` and `soulseek` domains are a module, `downloadsModule(options)`, in `kernlModules({ downloads })`, exposed as `kernl.downloads`. It requires the bridges module and signs in through `KernelContext.secrets`, the kernel's secrets provider. `ModuleInstance.rendersBindings` lets a module say the host's own prelude renders its bindings.
