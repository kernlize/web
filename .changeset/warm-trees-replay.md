---
"@kernlize/kernel": patch
"@kernlize/core": patch
---

Replay cached public tree events on approved Outbox subscriptions before opening the live relay read. One-shot Outbox queries merge cached events into the normal relay response. The cache module enables this without changes to applets or the Outbox API.
