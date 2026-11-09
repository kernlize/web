---
"@kernlize/core": minor
---

Add the applet store and intents. `kernl.catalog.load()` lists signed applet manifests from the applet and public relays, with `searchCatalog` and `popularTopics` for search and topic filters. `createKernl` now offers the `intent` domain: kernl's router over kehto's catalogue resolver picks the user's default, their published handler preference (kind 31129) or asks through the new optional `KernlHost.chooseHandler`, and delivers to the handler through `KernlHost.openApplet`. `kernl.intents` exposes the installed set and handler defaults, and `kernl.install` installs a verified applet without opening it. `AppletSummary.address` is now required and `summarize` takes it, which is a breaking change.
