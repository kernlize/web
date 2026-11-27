---
'@kernlize/ui-model': minor
---

`createTrafficLog(keep, fold?, lookback = 1)` can merge an arrival into a recent matching row and move it to the front, even when a burst interleaves requests and replies. `total(windowId)` counts arrivals after folding or eviction. Use `add(row, false)` for supplemental rows that should count toward marks but not the total.
