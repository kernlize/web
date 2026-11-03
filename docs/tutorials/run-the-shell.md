# Run the shell

This tutorial takes you from a clone to an applet running in a window, signed in with your own account. It takes about ten minutes.

::: warning Alpha
The shell runs, but it is a first draft. Expect rough edges in the UI and read [Alpha status](../alpha-status.md) for what is not there yet.
:::

## Prerequisites

- Node 22 or newer and pnpm 10. The repository pins `pnpm@10.24.0` through `packageManager`; `corepack enable` picks it up.
- A browser with a NIP-07 signing extension installed, or a remote signer that speaks NIP-46. You need one of the two to sign in; kernl never asks for a private key directly.
- The address of an applet to open. The [napplet.run app store](https://napplet.run/apps/) lists published applets with their addresses.

## 1. Clone and install

```bash
git clone https://github.com/kernlize/web.git kernl
cd kernl
pnpm install
```

`pnpm install` links the four workspace packages, the docs and the app. Nothing is downloaded at runtime later; the shell's CSP would not allow it.

## 2. Start the site

```bash
pnpm site:dev
```

This runs the Astro dev server for `apps/web`. The landing site is at the root and the shell at `/app/`:

```
http://localhost:4321/app/
```

The first load shows the shell with no account. The guard is already running in its `strict` profile; there is nothing to configure before signing in.

## 3. Sign in

Choose one:

**Browser extension.** Click *Sign in*, then *Use extension*. The shell asks the extension for your public key; the extension asks you for permission. kernl wraps the extension in an applesauce `ExtensionSigner`. Your key stays in the extension.

**Remote signer.** Click *Sign in*, then *Use remote signer*, and paste a `bunker://` URI or scan the `nostrconnect://` code with your signer app. kernl uses an applesauce `NostrConnectSigner`; the connection persists across reloads until you sign out.

After sign-in the shell loads your profile, your relay list and your contacts into the shared `EventStore`. The relay list drives the one `RelayPool` every service shares. If you have no relay list yet, the shell falls back to a small discovery set and tells you so.

## 4. Open an applet by address

Click *Open*, and paste an address. Any of these forms works:

- an `naddr1…` bech32 address,
- a `kind:pubkey:d-tag` coordinate,
- a URL from napplet.run that ends in one of the above.

The shell resolves the manifest, verifies its signature, fetches the artifact bytes by hash and verifies them. Nothing runs before verification passes. When it does, the shell shows you:

- the applet's name, author and the hash of the build you are about to run,
- the domains it `requires` and the ones it lists as optional,
- the guard profile it will run under (`strict`).

Required domains that need a grant are asked for now, one prompt, with each domain explained. Decline and the applet does not mount; you are told which requirement was not met. Accept and the window opens.

## 5. Watch the guard

Open the grants panel from the window's title bar. You see the applet's identity (`dTag` and hash), the domains you granted, and the eleven mitigations with the limit each one applies in the current profile. Minimise the window and the panel shows its traffic as *deferred*; restore it and the queue drains.

If the applet hits a limit, the panel lists the event with its reason, for example `rate:relay:publish`. [Change the guard profile](../how-tos/change-guard-profile.md) explains how to loosen this one applet if you decide it deserves it.

## 6. Revoke

In the same panel, each grant has a *Revoke* control, and the panel has *Revoke all*. Revoking a domain re-narrows the environment and the applet's next call to that domain returns `unavailable`. *Revoke all* also removes the window. Nothing about the applet is remembered except the fact that you revoked it, which the panel shows next time you open the same address.

## Where next

- [Grant and revoke](../how-tos/grant-and-revoke.md) for what each prompt means and what it changes.
- [Build an applet for kernl](./build-an-applet-for-kernl.md) if you came here to test your own applet.
- [Deploy](../how-tos/deploy.md) to publish your own instance of the shell.
