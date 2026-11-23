---
'@kernlize/core': minor
---

The file servers and the `upload` domain are a module, `filesModule()`, in `kernlModules()`, exposed as `kernl.files`. Without it `upload` is not offered. `KernelContext` gains `ask(summary)`, a question put to the person through the host's consent prompt. `KernlNetwork` holds only the replaceable loader, and `KernlNetworkParts` has no `destroyed$`.
