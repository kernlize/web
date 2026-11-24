---
'@kernlize/core': minor
---

`@kernlize/core/seal` is a new entry: the message seal (`MESSAGES_DOMAIN`, `MESSAGE_COMPANION_DOMAINS`, `sealsApplet`, `domainsInForce`, `withheldDomains`, `capabilitiesInForce`) and the domain capabilities (`BASELINE_DOMAINS`, `DOMAIN_CAPABILITIES`, `capabilitiesForDomain`, `capabilitiesForDomains`), without the network stack. `@kernlize/ui-model` reads the seal through it, so a host that draws the grants list bundles no third-party code.
