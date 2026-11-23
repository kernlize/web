---
'@kernlize/core': minor
---

The bridges are a module, `bridgesModule({ registry, torrent })`, in `kernlModules({ bridges, torrent })`, exposed as `kernl.bridges`. The kernel's `resource` service and downloads resolve through it; without it `resource` is not offered. `KernlOptions.bridges` and `KernlOptions.torrent` still reach it when a host names no modules. `KernlServiceDeps.bridges` is optional.
