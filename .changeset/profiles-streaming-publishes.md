---
"@kernlize/core": minor
---

Load profiles for the UI: `kernl.profiles` (`createProfiles`) asks the lookup relays and then the author's own write relays, with no timeout, and the session label follows the account's published name. The store streams (`kernl.catalog.stream`, `streamCatalog`), lists cached manifests first, says when nothing has arrived yet (`CATALOG_SETTLE_MS`) and leaves out manifests their publisher deleted. Publishes succeed when any relay accepts (`publishAccepted`; kehto's outbox router is wrapped to accept partial success), profiles, follows and relay lists route to indexers plus the user's own and general servers, and an author without a relay list writes to the shell's. A relay-list consent reads "Change your inbox and outbox". `createKernl` composes `kernl.mailboxes`, `kernl.directory` and the `eventCache` option, the `outbox` tier follows the account's published outboxes, and `RelayTiers` gains `set()`.

The applet catalogue tier now defaults to `relay.napplet.soy`, `relay.ditto.pub` and `relay.nostr.com`, the catalogues the public napplet stores read, so the store lists every napplet either lists. Manifests from the relays are kept in the event store, so the event cache holds them for the next visit.

Conversations listed through the `dm` domain name their participants from published profiles (`labelConversations`, `Profiles.settled`), so a messaging applet shows names instead of account ids.
