---
'@kernlize/modules': minor
'@kernlize/kernel': minor
---

Only reuse an intent handler window that started with the `intent` domain and whose verified manifest declares the requested convention. Check the manifest again when the host opens the handler on demand, and keep kehto's recipient check for every delivery. The window entries in `KernlIntentDeps.handles` and `KernelContext.applets()` include their startup `domains`. `IntentDeliveryOptions.findWindow` receives the convention, and `send` receives the intended handler and convention for checking the opened window.
