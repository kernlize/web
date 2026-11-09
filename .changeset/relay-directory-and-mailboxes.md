---
"@kernlize/core": minor
---

Publish outcomes, a relay directory and account mailboxes.

`summarizePublish` and `describeOutcome` treat a publish any relay accepted as a success and say how many did (`PublishOutcome`). `createRelayDirectory` streams NIP-66 monitor reports from `DEFAULT_MONITOR_RELAYS` and offers `search` and `suggest`, falling back to `DEFAULT_SUGGESTIONS` with no reports. `createAccountMailboxes` streams the active account's NIP-65 list, says it is missing only once every lookup relay finished, and saves a new one to old and new relays and the lookup relays; `mailboxesFromEvent` and `mailboxTags` read and write the list. `toRelayUrl` and `relayUrls` normalise relay URLs. `subscribeWithEose` accepts any pool with `req`.
