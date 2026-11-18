---
"@kernlize/core": minor
---

`fetchManifestEvent`, and so `Kernl.resolve`, now throws `unavailable:unreachable` when no relay opened a connection, and keeps `unavailable:network` for relays that connected and did not answer in time (D-039). An empty answer from relays that never connected no longer reads as `unavailable:manifest`. Hosts matching only `unavailable:network` should also match the new reason.
