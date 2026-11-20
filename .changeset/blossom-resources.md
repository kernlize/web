---
"@kernlize/bridges": minor
"@kernlize/core": minor
---

Applets' `blossom:` resources load. `createBlossomBridge` and `parseBlossomReference` are new in `@kernlize/bridges`: the bridge reads BUD-10 references and the `blossom:sha256:<hash>` form, asks the reference's hints and then the requester's servers under the web policy, and returns only bytes whose hash matches. `createDefaultBridges` registers it, with `blossomServers` for each requester's servers, and `createKernl` passes the running applet's manifest servers. Resource failures now reach applets as their NAP-RESOURCE codes (`not-found`, `unsupported-scheme`, `blocked-by-policy`, …) through the new `resourceErrorFor`, instead of all as `network-error`.
