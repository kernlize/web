# How-tos

One task per page, with the exact calls. Each assumes you have the kernl source and have run `pnpm install && pnpm build` ([Run the shell](../tutorials/run-the-shell.md#_1-clone-install-and-build)); for a guided first pass, start with the [tutorials](../tutorials/run-the-shell.md) instead.

| How-to | What it does |
| --- | --- |
| [Inspect an applet's messages](./inspect-applet-messages.md) | See what an applet sent and got back, with failures and the guard's warnings marked. |
| [Change the guard profile](./change-guard-profile.md) | Switch the shell between `strict`, `balanced` and `relaxed`, and what a profile can and cannot change. |
| [Change the firewall rules](./change-firewall-rules.md) | Set what applets may do without asking, by request, by kind and per applet, and take back the answers in force. |
| [Grant and revoke](./grant-and-revoke.md) | What the shell asks when an applet opens, what each answer changes, and the `Kernl` calls behind the grants panel. |
| [Change the shell's layout](./change-the-shells-layout.md) | Change the spacing, choose which layouts the shell offers, and register a layout of your own. |
| [Write your own window manager](./write-a-window-manager.md) | Replace how windows are placed, focused and stacked, and the one rule a window manager must keep: tell the guard the truth about what the person can see. |
| [Write a module](./write-a-module.md) | Give the shell an opinion of your own: an id, an api, the kernel's context, and what it may and may not do. |
| [Replace a module](./replace-a-module.md) | Leave one of kernl's modules out, or put one of yours in its place under the same id. |
| [Render an ask your own way](./render-an-ask.md) | Draw every question the kernel and your modules raise in your own UI, reworded or not, and close the ones that are withdrawn. |
| [Add a messaging provider](./add-a-messaging-provider.md) | Define a provider and its backend, and hand it to the messaging module. |
| [Add a bridge backend](./add-a-bridge-backend.md) | Supply a backend that turns an `unavailable` bridge, such as downloads, into a working one, through the bridges module. |
| [Add a cache backend](./add-a-cache-backend.md) | Keep events in a store of your own, from an applesauce event database or your own rows, and hand it to the cache module. |
| [Connect a program](./connect-a-download-program.md) | Give the shell the address and sign-in of Transmission, uTorrent, NZBGet, SABnzbd or slskd, read what a failed check means, and put a reverse proxy in front of a program that does not accept requests from the page. |
| [Swap the secrets provider](./swap-the-secrets-provider.md) | Keep the passwords and keys the shell signs in with in a keeper of your own, by passing a `SecretsProvider` to `createKernl`. |
| [Deploy](./deploy.md) | Build the site, shell, docs and API reference into one static artifact and publish it to kernl.run on bunny.net. |
| [Publish packages](./publish-packages.md) | Configure npm and JSR, validate artifacts, release and retry. |
