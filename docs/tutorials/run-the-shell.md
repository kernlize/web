# Run the shell

This tutorial takes you from a clone to an applet running in a window, signed in with your own account, and shows the `Kernl` calls behind each step. It takes about ten minutes.

::: warning Alpha
The shell runs, but it is a first draft. Expect rough edges in the UI and read [Alpha status](../alpha-status.md) for what is not there yet.
:::

## Prerequisites

- Node 22 or newer and pnpm 10. The repository pins `pnpm@10.24.0` through `packageManager`; `corepack enable` picks it up.
- A way to sign: a browser extension that speaks NIP-07, a remote signer that speaks NIP-46, or nothing, in which case the shell creates a local account protected by a password. kernl never asks for a private key directly and never stores one in plaintext.
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

The first load shows the shell with no account. `boot.ts` has called `createKernl({ host })`, where `host` is the page's `KernlHost`: `localStorage`, the consent dialog, the notices, link confirmation and window visibility. The guard is already running in its `strict` profile and the relay tiers are `DEFAULT_RELAY_TIERS`. Add `?preview=1` to the URL to run the offline preview instead, with two sample applets and no network (D-011).

## 3. Sign in

Click *Sign in* and choose one:

- **Browser extension.** The shell wraps the extension in an applesauce `ExtensionAccount`; your key stays in the extension.
- **Remote signer.** Paste a `bunker://` address, or show the pairing code to your signer app. Either way the shell holds a `NostrConnectAccount` over an applesauce `NostrConnectSigner` that talks through the shell's own `RelayPool`.
- **Read-only.** Paste a public key. The session is `readOnly`, applets see the identity, and every write is refused because `createAuthHooks` returns no signer.
- **Create a local account.** Choose a password. The shell generates a key inside an applesauce `PasswordSigner` and persists it as a `PasswordAccount`, whose serialised form is NIP-49 encrypted. A plaintext-key account is refused by `KernlAccountManager` with `denied:plaintext-key-persistence`.

Each path ends in `kernl.login(account)`, which adds the account to the `AccountManager` if it is new, makes it active and emits a `Session` on `kernl.session$`. Accounts and the active choice persist at `kernl:accounts:v1` and `kernl:active-account:v1`, so the next load signs you in again (a password account asks to be unlocked). Nothing is fetched at sign-in: profile, follows and relay list are loaded from the `discovery` tier the first time an applet or the shell asks for them.

```ts
import { createKernl, type KernlHost } from '@kernl/core';
import type { IAccount } from 'applesauce-accounts';

declare const host: KernlHost;
declare const account: IAccount;

const kernl = createKernl({ host, relays: { apps: ['wss://relay.napplet.soy'] } });

const session = await kernl.login(account);
session.readOnly; // true for a ReadonlyAccount; writes are then refused
```

## 4. Open an applet by address

Click *Open* and paste an address. `kernl.decodePointer` accepts an `naddr1…`, an `nevent1…` or `note1…`, a bare 64-hex event id, any of those behind `nostr:`, and a coordinate in either `<pubkey>:<kind>:<identifier>` or `<kind>:<pubkey>:<identifier>` order. Anything else is `invalid:pointer`.

`kernl.resolve(pointer)` fetches the manifest from the pointer's relay hints plus the `apps` tier, verifies its signature, fetches the artifact bytes by hash and verifies them. Nothing runs before verification passes; a tampered artifact is `invalid:blob-hash-mismatch`, a missing one `unavailable:blob`, a manifest nobody serves `unavailable:manifest`. When it passes, the launcher shows the `AppletSummary`: title, publisher, the identity (`dTag` and the hash of the build you are about to run), and the domains it `requires` and lists as `optional`, each as a switch.

The baseline domains (`shell`, `inc`, `theme`, `identity`, `storage`) are always on and cannot be switched off. Every other switch starts where this identity's grants already are, which on a first run is off; a required domain is marked "the applet says it needs this", and a warning names the required domains still off and says you can run anyway. Click *Run*. The launcher calls `kernl.grants.allowDomain` for each switch you turned on and `kernl.grants.revokeDomain` for each you turned off, then `kernl.plan(summary)`, and opens a window for the `MountPlan`. If `plan.missingRequired` is not empty, the applet sees those domains as unavailable.

```ts
const summary = await kernl.resolve(kernl.decodePointer(`${session.pubkey}:35129:chat`));
summary.requires; // advisory, never a grant
const plan = await kernl.plan(summary);
plan.missingRequired; // required domains the user has not allowed
```

The window's iframe is mounted with `kernl.mount(plan, iframe)`: the frame gets `sandbox="allow-scripts"` and the controller-denying `allow` policy, is registered with its verified identity, has its environment frozen, is watched for a second load, and only then receives `srcdoc`. The applet sends its `hello`, which passes through the guard pipeline on its way to kehto's bridge, and `shell.init` tells it the domains it has.

## 5. Watch the guard

The desktop bar shows *Guard · strict · N*, where N counts guard events. Open it to see the profile, the eleven mitigations with the limit each one applies in the current profile (`kernl.guard.mitigations()`), and the event log (`kernl.guard.events$`). If an applet hits a limit, the log shows the window, the operation class and the reason, for example `rate:relay:publish` or `flood:quarantine`. A quarantined applet is revoked and its window removed; the notice says so.

Changing the profile here calls `kernl.guard.setProfile(profile)`, which rebuilds the guard for every window and is not remembered across reloads. [Change the guard profile](../how-tos/change-guard-profile.md) has the details and the numbers.

## 6. Grant, revoke, block

Each window has a grants panel. It lists every domain the shell offers (`kernl.grants.availableDomains()`) as a switch, with the baseline fixed on. Turning a switch on is `kernl.grants.allowDomain(identity, domain)`; off is `kernl.grants.revokeDomain(identity, domain)`. Both write kehto's ACL at once, so the applet's next call on a revoked domain is refused; the domains it was told about at mount do not change until it is opened again. *Block* is `kernl.grants.block(identity)`: the ACL denies everything and the next mount advertises `shell` alone. Closing the window is `handle.close()`, which revokes the binding and removes the frame; the grants stay, keyed by identity, for the next time you open the same build.

[Grant and revoke](../how-tos/grant-and-revoke.md) covers each call and what it changes.

## Where next

- [Grant and revoke](../how-tos/grant-and-revoke.md) for what each prompt means and what it changes.
- [Build an applet for kernl](./build-an-applet-for-kernl.md) if you came here to test your own applet.
- [Deploy](../how-tos/deploy.md) to publish your own instance of the shell.
