---
"@kernlize/kernel": minor
---

Allow hosts to back public Outbox observations with asynchronous storage. The web shell uses IndexedDB and keeps observations without a time limit, evicting the least recently observed events when the shared 100 MiB budget would be exceeded.
