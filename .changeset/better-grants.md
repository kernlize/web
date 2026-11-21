---
'@kernlize/core': minor
---

Grants made for now, and an exception to the message seal the person can make. `Grants.allowDomain` takes `{ unsafe, remember }` and `revokeDomain` takes `{ remember }`; `Grants.forgetTemporary(identity)` drops what was granted for now, and kernl calls it when an applet's last window ends. `GrantRecord` gains `unsafe` (domains the person kept beside messages, which stay in force; `intent:write` stays withheld) and `temporary`. `domainsInForce`, `withheldDomains` and `capabilitiesInForce` take the kept domains. `AppletAdmissions` gains `isWaiting`. A custom `Grants` implementation must add `forgetTemporary` and the two record fields.
