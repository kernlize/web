# Run the shell

This tutorial takes you from nothing to an applet running in a window, signed in with your own account, and shows the `Kernl` calls behind each step. The hosted preview takes a minute and needs no install; running the shell from source takes about ten minutes and needs access to the source repository.

::: warning Alpha
The shell runs, but it is a first draft. Expect rough edges in the UI and read [Alpha status](../alpha-status.md) for what is not there yet.
:::

## 0. Try it without installing anything

Open the hosted preview:

```
https://kernl.run/app/?preview=1
```

The preview runs the same shell UI over an offline stand-in for the `Kernl` contract, with a store of three preview applets and no network ([D-011](../decisions.md#d-011), [D-024](../decisions.md#d-024)). It behaves like the live shell where it stands in for it: it asks before a write only for the kinds `@kernlize/core` rates destructive, using the core's own `isDestructiveKind` and `describeChange`; its guard observes and stops an applet only by quarantine; it starts in `strict` on every load; and its applets remove WebRTC the way kehto's prelude does. Messaging here goes nowhere; in the live shell private and legacy messages are sent for real once you sign in with an account that can encrypt ([Alpha status](../alpha-status.md#messaging-providers-in-the-live-shell)).

**You should now see** a card headed "Who is at the keyboard?" with a **Try the preview** button. Click it, then **Open an applet**; the store lists *Notes*, *Pulse* and *Profiles* with topic bubbles above them. Type `profle` into the search to see the loose matching, clear it, then open *Notes*, turn on the *network* switch (it starts off, like most grants on a first run), and click **Run**. It appears in a window with buttons to try:

- **Publish a note** goes out without a prompt: a note is routine.
- **Update your profile** and **Delete a note** ask first: the consent dialog shows what changes, and nothing happens until you answer.
- **Flood the shell** sends 40 network reads at once; the guard panel (*Guard · strict · N* in the bar) records the burst.
- **Open a profile** asks another applet to do it. None of yours can yet, so the shell offers the store's *Profiles*; pick it, tick **Always use it to open a profile**, and click **Use this applet**. *Profiles* opens and logs the request; ask again and it goes straight there. See [The store and intents](../concepts/store-and-intents.md).

Without `?preview=1`, `https://kernl.run/app/` is the live shell: everything below from step 3 on works there too, against real relays.

## Prerequisites for running from source

- Access to the kernl source repository. It is private during the alpha; the packages are not released on npm (`@kernlize/*`) or JSR (`@kernl/*`) either ([Packages](../packages/index.md#install)). Without access, use the hosted shell above.
- Node 22 or newer and pnpm 10. The repository pins `pnpm@10.24.0` through `packageManager`; `corepack enable` picks it up.
- A way to sign: a browser extension that speaks NIP-07, a remote signer that speaks NIP-46, or nothing, in which case the shell creates a local account protected by a password. kernl never asks for a private key directly and never stores one in plaintext.
- Nothing else: the live shell's store lists published applets. An address from a publisher (an `naddr1…` or `nevent1…` string, or a coordinate) also works pasted into the store's search; step 4 gives one you can try.

## 1. Clone, install and build

```bash
git clone https://github.com/kernlize/web.git kernl
cd kernl
pnpm install
pnpm build
```

`pnpm install` links the four workspace packages, the docs and the app. `pnpm build` compiles the packages into their `dist/` folders, which is what the app imports; skip it and the dev server cannot resolve `@kernlize/…` ([Troubleshooting](../guides/troubleshooting.md#pnpm-site-dev-before-pnpm-build)). Nothing is downloaded at runtime later; the shell's CSP would not allow it.

**You should now see** `pnpm build` finish with a `dist/` folder in each of `packages/guard`, `packages/messaging`, `packages/bridges` and `packages/core`.

## 2. Start the site

```bash
pnpm site:dev
```

This runs the Astro dev server for `apps/web`. The landing site is at the root and the shell at `/app/`:

```
http://localhost:4321/app/
```

The first load shows the shell with no account. `boot.ts` has called `createKernl({ host })`, where `host` is the page's `KernlHost`: `localStorage`, the consent dialog, the notices, link confirmation and window visibility. The guard is already running in its `strict` profile and the relay tiers are `DEFAULT_RELAY_TIERS`. Add `?preview=1` to the URL to run the offline preview instead.

**You should now see** the sign-in card, "Who is at the keyboard?", with a list headed "Sign in another way". If instead a notice says "Running the preview" with "The live shell could not start (…)", the core failed to load; see [Troubleshooting](../guides/troubleshooting.md).

## 3. Sign in

Under "Sign in another way", pick one:

- **Use a browser extension** (button **Use**, shown only when an extension is present). The shell wraps the extension in an applesauce `ExtensionAccount`; your key stays in the extension.
- **Connect a remote signer** (button **Connect**). Either paste the code your signer app shows (a `bunker://` URI) into "Pairing code from your signer app" and click **Connect**, or click **Or pair from the signer**: the shell shows a QR code to scan with your signer app and a **Copy pairing code** button for pasting it there instead (a `nostrconnect://` URI), then waits with "Waiting for the signer to accept…". Either way the shell holds a `NostrConnectAccount` over an applesauce `NostrConnectSigner` that talks through the shell's own `RelayPool`.
- **Read-only** (button **Choose**). Paste a public key into "Account id" and click **Continue**. The session is `readOnly`: applets you grant *your account* see that public key, and every write is refused because `createAuthHooks` returns no signer.
- **Create a local account** (button **Create**). Choose a password, repeat it, and click **Create and sign in**. The shell generates a key inside an applesauce `PasswordSigner` and persists it as a `PasswordAccount`, whose serialised form is NIP-49 encrypted. A plaintext-key account is refused by `KernlAccountManager` with `denied:plaintext-key-persistence`.

Each path ends in `kernl.login(account)`, which adds the account to the `AccountManager` if it is new, makes it active and emits a `Session` on `kernl.session$`. Accounts and the active choice persist at `kernl:accounts:v1` and `kernl:active-account:v1`, so the next load lists the account under "Remembered accounts" with a **Sign in** button (a password account asks to be unlocked). Nothing is fetched at sign-in: profile, follows and relay list are loaded from the `discovery` tier the first time an applet or the shell asks for them.

```ts
import { createKernl, type KernlHost } from '@kernlize/core';
import type { IAccount } from 'applesauce-accounts';

declare const host: KernlHost;
declare const account: IAccount;

const kernl = createKernl({ host, relays: { apps: ['wss://relay.napplet.soy'] } });

const session = await kernl.login(account);
session.readOnly; // true for a ReadonlyAccount; writes are then refused
```

**You should now see** the desktop: an **Open an applet** button, "Workspace 1 · 0 windows" with a button naming the current layout (`floating` or `tiled`; click it to switch), "No applets open. Press Alt + / or use the button above.", and on the right *Guard · strict · 0*, **Messages** and your account name, whose menu holds **Settings** and **Sign out**. At 720 px wide or less the bar shows **Open** and a **Menu** button instead; the menu sheet holds the guard, messages, layout, minimised windows, **Settings** and **Sign out**, and each window fills the screen.

**Settings** lists the four server tiers (Discovery, Applet catalogue, Your connections, General) by display name, so `wss://relay.damus.io` reads `damus.io`; add one by typing it into "Server address" (a bare hostname gets `wss://`). Under "Bridges" it names each bridge by what it does, *Downloads (web)*, *Downloads (from peers)*, *Downloads (archives)*, *Sharing* and *Mail*, with an "Availability" of "Ready" or "Needs a backend" and what the other side learns. "About" shows the shell's version, `kernl 0.1.0`, and whether it is live or the offline preview.

## 4. Open an applet from the store, or by address

Click **Open an applet** (or press Alt+/). The store lists the applets published to your applet catalogue and general servers, newest first, with the most common topics as bubbles; type to search, click a bubble to filter, and click **Open** on one. By default it lists only applets whose required capabilities this shell offers, and says how many it hides. To open an applet by address instead, paste it into the same search field ("Find an applet") and click **Look up**.

**An applet you can try.** *Freeze Frame Response*, a physics puzzle, is published by a third party in the [napplet.run](https://napplet.run/apps/) catalogue, not by kernl. It needs no grants:

```
naddr1qvzqqqyf8ypzqw49s9e88sajl985jxzquprj7pyapugqp83rme3sqctxhj5mxm4rqythwumn8ghj7un9d3shjtnwv9c8qmr9wsh8xmmeqqxkuttzvy6nyefnxpjr2e3jqg5uk8
```
 `kernl.decodePointer` accepts an `naddr1…`, an `nevent1…` or `note1…`, a bare 64-hex event id, any of those behind `nostr:`, and a coordinate in either `<pubkey>:<kind>:<identifier>` or `<kind>:<pubkey>:<identifier>` order. Anything else is `invalid:pointer`, shown as "That does not look like an applet address."

`kernl.resolve(pointer)` fetches the manifest from the pointer's relay hints plus the `apps` tier, verifies its signature, fetches the artifact bytes by hash and verifies them. Nothing runs before verification passes; a tampered artifact is `invalid:blob-hash-mismatch`, a missing one `unavailable:blob`, a manifest nobody serves `unavailable:manifest`. When it passes, the launcher shows the `AppletSummary`: title, publisher, description, and under "What it may use" the domains it `requires` and lists as `optional`, each as a switch.

Baseline domains (`shell`, `inc`, `theme`, `storage`) are marked "always on" and cannot be switched off. Every other switch starts where this identity's grants already are, which on a first run is off. That includes *your account* (`identity`): until you turn it on, the applet is not told who is signed in; a required domain is marked "the applet says it needs this", and while one is off the launcher warns "Without …, this applet may not work. You can still run it." Click **Run**. The launcher calls `kernl.grants.allowDomain` for each switch you turned on and `kernl.grants.revokeDomain` for each you turned off, then `kernl.plan(summary)`, and opens a window for the `MountPlan`. If `plan.missingRequired` is not empty, the applet sees those domains as unavailable.

<!-- sample:continues -->
```ts
declare const address: string; // from the applet's publisher

const summary = await kernl.resolve(kernl.decodePointer(address));
summary.requires; // advisory, never a grant
const plan = await kernl.plan(summary);
plan.missingRequired; // required domains the user has not allowed
```

`kernl.plan` also refuses an applet whose verified markup contains a frame element of its own, with `denied:nested-frame`, and puts kernl's frame lock in the `srcdoc` right after kehto's prelude ([D-014](../decisions.md#d-014)). The window's iframe is mounted with `kernl.mount(plan, iframe)`: the frame gets `sandbox="allow-scripts"` and the controller-denying `allow` policy, is registered with its verified identity, has its environment frozen, is watched for a second load, and only then receives `srcdoc`. The applet sends its `hello`, which passes through the guard pipeline on its way to kehto's bridge, and `shell.init` tells it the domains it has.

**You should now see** a window titled with the applet's name, with **Grants**, **Minimise** and **Close** in its title bar. It shows "Starting …" briefly, then the applet.

## 5. Watch the guard

The desktop bar shows *Guard · strict · N*, where N counts guard events this session. Click it to see the profile, the eleven protections with the limit each one applies in the current profile (`kernl.guard.mitigations()`), and "Recent events" (`kernl.guard.events$`). Each event is a sentence naming the applet, what happened and why, for example "Applet Notes went over a limit: too many publishes", which is the guard's `rate:relay:publish`. A quarantined applet has its binding revoked and its frame removed; the window shows "This applet was stopped." and a notice says so.

Over-budget requests are refused before they are handled, by kehto's runtime firewall with the rates kernl installs at mount, and so are oversized downloads and queries; the guard panel shows kernl's count of the same budgets. Changing the profile here calls `kernl.guard.setProfile(profile)`. kernl's own counting switches at once; windows already open keep the refusal rates they were mounted with until you open them again, and the choice is not remembered across reloads. [Change the guard profile](../how-tos/change-guard-profile.md) has the details and the numbers.

**You should now see** the guard panel with `strict (default)` selected and, for a quiet applet, no events.

## 6. Grant, revoke, block

Each window's **Grants** button opens its grants panel. It lists every domain the shell offers (`kernl.grants.availableDomains()`) as a switch, with the baseline fixed on. Turning a switch on is `kernl.grants.allowDomain(identity, domain)`; off is `kernl.grants.revokeDomain(identity, domain)`. Both write kehto's ACL at once, so the applet's next call on a revoked domain is refused; the domains it was told about at mount do not change until it is opened again. Under "Standing", **Block applet** is `kernl.grants.block(identity)`: the ACL denies everything and the next mount advertises `shell` alone (**Unblock applet** reverses it). Closing the window is `handle.close()`, which revokes the binding and removes the frame; the grants stay, keyed by identity, for the next time you open the same build.

[Grant and revoke](../how-tos/grant-and-revoke.md) covers each call and what it changes.

**You should now see** the grants panel's "Standing" rows: the storage quota, "Blocked: no" and the number of guard events this window has had.

## Where next

- [Grant and revoke](../how-tos/grant-and-revoke.md) for what each prompt means and what it changes.
- [Applets under kernl](../concepts/applets-under-kernl.md) if you came here to test your own applet.
- [Embed kernl core](../how-tos/embed-kernl-core.md) to run the core in your own page instead of `apps/web`.
- [Deploy](../how-tos/deploy.md) to publish your own instance of the shell.
