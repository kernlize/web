---
'@kernl/core': minor
---

Add `createPrivateMessagesBackend` and `createLegacyMessagesBackend`, which carry messages with only the active account's signer, and wire them as the default `private` and `legacy` backends in `createKernl`. Availability now follows the active account. `MESSAGING_UNAVAILABLE_REASONS` is now `{ signInRequired, signerCannotEncrypt, noRuntime }`; `needs-local-key-signer` and `not-implemented` are gone.
