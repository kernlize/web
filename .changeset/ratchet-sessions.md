---
'@kernl/core': minor
---

Add `createRatchetMessagesBackend`, ratchet sessions over the `nostr-double-ratchet` runtime with the account signer signing the device list, and `createSealedRatchetStorage`, which keeps the library's device and session keys only as `nip44` ciphertext sealed to the account. `createKernl` wires it as the default `ratchet` backend, available while the signer has `nip44` (D-016).
