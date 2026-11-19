---
'@kernlize/core': minor
---

Seal applets that hold the `dm` grant: only the domains that cannot send a message elsewhere stay in force (`MESSAGE_COMPANION_DOMAINS`), and the rest are withheld from the ACL and the environment. `GrantRecord` gains `withheld`. Adds `domainsInForce`, `withheldDomains`, `capabilitiesInForce` and `sealsApplet`.
