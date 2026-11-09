# How-tos

One task per page, with the exact calls. Each assumes you have the kernl source and have run `pnpm install && pnpm build` ([Run the shell](../tutorials/run-the-shell.md#_1-clone-install-and-build)); for a guided first pass, start with the [tutorials](../tutorials/run-the-shell.md) instead.

| How-to | What it does |
| --- | --- |
| [Change the guard profile](./change-guard-profile.md) | Switch the shell between `strict`, `balanced` and `relaxed`, and what a profile can and cannot change. |
| [Grant and revoke](./grant-and-revoke.md) | What the shell asks when an applet opens, what each answer changes, and the `Kernl` calls behind the grants panel. |
| [Change the shell's layout](./change-the-shells-layout.md) | Change the spacing, choose which layouts the shell offers, and register a layout of your own. |
| [Write your own window manager](./write-a-window-manager.md) | Replace how windows are placed, focused and stacked, and the one rule a window manager must keep: tell the guard the truth about what the person can see. |
| [Embed kernl core](./embed-kernl-core.md) | Implement `KernlHost`, call `createKernl` and mount an applet in an iframe your own page owns. |
| [Add a messaging provider](./add-a-messaging-provider.md) | Define a provider and its backend, and register it in the shell's messaging registry. |
| [Add a bridge backend](./add-a-bridge-backend.md) | Supply a backend that turns an `unavailable` bridge, such as downloads, into a working one. |
| [Add a cache backend](./add-a-cache-backend.md) | Keep events in a store of your own, from an applesauce event database or your own rows, in front of the browser's defaults. |
| [Deploy](./deploy.md) | Build the site, shell, docs and API reference into one static artifact and publish it to kernl.run on bunny.net. |
| [Publish packages](./publish-packages.md) | Configure npm and JSR, validate artifacts, release and retry. |
