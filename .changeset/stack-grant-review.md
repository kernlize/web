---
'@kernlize/kernel': minor
---

`kernl.withGrantReview(summary, open)` keeps temporary applet grants in force during a reviewed replacement. The callback can reuse a mounted plan only when its startup domains still match, or plan and mount a fresh instance. Custom shell implementations must supply the new method.
