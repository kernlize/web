---
'@kernlize/ui-model': patch
---

The view models read the message seal and the ask kinds from `@kernlize/kernel/seal` and `@kernlize/kernel/asks`, and depend on `@kernlize/kernel` instead of `@kernlize/core` (D-068). Nothing they export changes.
