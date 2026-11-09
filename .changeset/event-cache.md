---
'@kernlize/core': minor
---

Add `@kernlize/core/cache`: an event cache behind one adapter contract. `openEventCache` opens the first adapter that works and falls back to memory; `defaultWebCacheAdapters()` is sqlite-wasm over the OPFS SAH pool in a worker, then IndexedDB, then memory. `fromEventDatabase` wraps any applesauce event database, and `attachEventCache` wires a cache to an `EventStore` and its loaders. A damaged sqlite database is wiped, rotated or given up on, never read.
