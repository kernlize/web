---
"@kernlize/core": minor
---

Applets can have settings (NAP-CONFIG). `createAppletConfig` keeps each applet's values by catalogue id, so an update keeps them, and opens the host's settings form through the new optional `KernlHost.presentSettings`. The shell offers the `config` domain only when the host provides that form.
