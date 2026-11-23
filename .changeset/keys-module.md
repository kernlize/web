---
'@kernlize/core': minor
---

Applets' keyboard shortcuts, the `keys` domain, are a module, `keysModule(settings)`, in `kernlModules({ shortcuts })`. Without it `keys` is not offered and leaves the baseline every applet starts with. `KernelContext` gains `isFocused(windowId)`. `KernlServiceDeps.keys: null` leaves the domain to the module, and `KernlServices.keys` may be undefined.
