---
'@kernlize/ui-model': minor
---

Ask queues (#74): `createAskQueue` shows asks one at a time in arrival order, answers each to its own ask, and dismisses a revoked window's asks and withdrawn ones with their refusal, streaming what waits as `waiting$` and `current$`. `createAskQueues` makes one per kind, and `createAskRenderers` turns queues into `KernlHost.asks`; several kinds may share one queue.
