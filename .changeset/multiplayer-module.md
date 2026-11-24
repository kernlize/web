---
'@kernlize/core': minor
---

Remote tools and direct connections are a module, `multiplayerModule({ remoteTools, directConnections })`, in `kernlModules()`, exposed as `kernl.multiplayer`. Without it `cvm` and `webrtc` are not offered. `KernelContext` gains `holds(windowId, domain)`. `createKernlServices` no longer wires `webrtc` or reads the person's multiplayer settings, and `KernlServiceDeps` loses `directConnections` and `multiplayer`; `remoteTools: null` leaves `cvm` to the module. `DirectConnectionsDeps` is removed.
