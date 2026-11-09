---
'@kernlize/core': minor
---

Add `@kernlize/core/crypto`: `installCryptoFallback` fills in `crypto.randomUUID` and a pure-JS `crypto.subtle` outside a secure context (onion or overlay addresses over HTTP). The mount plan gives applet frames a `randomUUID` fallback.
