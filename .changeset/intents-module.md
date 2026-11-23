---
'@kernlize/core': minor
---

Applets handing work to each other, the `intent` domain, are a module, `intentsModule()`, in `kernlModules({ intentRetry })`, exposed as `kernl.intents`. Without it `intent` is not offered and `kernl.install` refuses with `unavailable:intents`. `Intents` gains `record(summary)`. `KernelContext` gains `applets()` and `host`. `KernlIntentDeps` takes the signed-in `identity` instead of the account manager.
