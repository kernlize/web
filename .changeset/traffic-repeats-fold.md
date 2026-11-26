---
'@kernlize/ui-model': minor
---

The traffic log can fold a repeat into the row it repeats, and counts every row a window has had.

`createTrafficLog(keep, fold?)` takes a `fold(kept, arriving)` that returns the row to keep in the newest row's place, or `undefined` to keep both. A shell whose applets stream state or send bursts uses it so one repeated message takes a single row instead of pushing the failure the person is looking for out of the log. `total(windowId)` is new: it counts every row a window has had, folded ones included, where `forWindow` still returns only the newest kept rows.
