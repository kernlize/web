---
"@kernlize/core": patch
---

Opening an applet address no longer depends on every relay behaving. `fetchManifestEvent` ignores hints that are not relay URLs, survives relays that are down, silent or hang up, no longer lets a quick relay with nothing end the lookup before a slower catalogue answers, and always ends within `MANIFEST_TIMING.timeoutMs`; it takes an optional `timing` argument. No relay answering is the new reason `unavailable:network` where it used to be the relay library's unprefixed error. `decodePointer` finds an encoded address inside a link or a sentence. The `identity` service answers `identity.getPublicKey` for a read-only account, through the new optional `KernlServiceDeps.auth.getUserPubkey`.
