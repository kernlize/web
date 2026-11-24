---
'@kernlize/core': minor
---

`Kernel` is now the kernel's own interface, and `Kernl` is `Kernel & KernlMembers`, where `KernlMembers` lists the members kernl's own modules provide and `ModuleMembers` is its keys. `Kernl` is a type alias now, not an interface, so it can no longer be extended with `interface … extends Kernl` merging; extend `Kernel` or intersect instead. `KernlOptions` is likewise `KernelBaseOptions & KernlModuleOptions & { modules? }`: `KernelBaseOptions` holds what the kernel takes, `KernlModuleOptions` what only kernl's own modules read (`KernlModuleOptionKeys` is its keys), and `KernelOptions` is `KernelBaseOptions` with `modules` required.
