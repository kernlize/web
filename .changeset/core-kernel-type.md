---
'@kernlize/core': minor
---

`Kernel` is now the kernel's own interface, and `Kernl` is `Kernel & KernlMembers`, where `KernlMembers` lists the members kernl's own modules provide and `ModuleMembers` is its keys. `Kernl` is a type alias now, not an interface, so it can no longer be extended with `interface … extends Kernl` merging; extend `Kernel` or intersect instead.
