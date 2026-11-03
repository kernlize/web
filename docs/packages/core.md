# @kernl/core

Opinionated shell composition over kehto and applesauce. Browser-agnostic: the DOM is reached only through the `KernlHost` hooks and the `FrameLike` shape, so the whole composition runs in vitest against fakes.

| Field | Value |
| --- | --- |
| Package | `@kernl/core` |
| Version | `0.1.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | `@kernl/guard`, `@kernl/messaging`, `@kernl/bridges` (`workspace:^`); `@kehto/acl ^0.20.2`, `@kehto/firewall ^0.6.3`, `@kehto/runtime ^0.27.2`, `@kehto/shell ^0.29.0`, `@kehto/services ^0.29.0`, `@kehto/nip ^0.8.0`, `@kehto/wm ^0.0.2`; `applesauce-core ^7.0.3`, `applesauce-relay ^7.0.0`, `applesauce-signers ^7.0.1`, `applesauce-accounts ^7.0.2`, `applesauce-loaders ^7.0.2`; `rxjs ^7.8.2` |
| Peer dependencies | `@napplet/core >=0.37.0 <0.38.0`, `@napplet/nap >=0.36.0 <0.37.0`, `@napplet/shim >=0.30.0`, `nostr-tools >=2.23.3 <=2.x` (required by kehto and applesauce; never imported here) |
| Side effects | none |

## Install

`@kernl/core` is not yet published to npm, so `pnpm add @kernl/core` fails. During the alpha it is built from the kernl source repository, which is private, and consumed as a workspace dependency. The [package index](./index.md#install) has the steps.

```json
{ "dependencies": { "@kernl/core": "workspace:^" } }
```

## Purpose

This is where the five opinions in `SOUL.md` become code. `createKernl` builds one `EventStore`, one `RelayPool` and one `AccountManager`, adapts them to kehto's relay, auth and dm contracts, registers kehto's reference services, builds the `ShellAdapter` and hands it to `createShellBridge`, puts the guard pipeline in front of the bridge for the window-level `hello` and behind it, as an observer, for port traffic, wraps the account signer so destructive signatures ask the user first, and exposes the applet lifecycle (`decodePointer` → `resolve` → `plan` → `mount`), the grants surface, consent summaries and layouts to the shell app. The layering is in [Architecture](../concepts/architecture.md).

```ts
import { createKernl, type KernlHost } from '@kernl/core';

declare const host: KernlHost;
declare const iframe: HTMLIFrameElement;

const kernl = createKernl({ host });
window.addEventListener('message', (event) => kernl.handleWindowMessage(event));

const summary = await kernl.resolve(kernl.decodePointer('nostr:naddr1…'));
kernl.grants.allowDomain(summary.identity, 'relay');
const plan = await kernl.plan(summary);
if (plan.missingRequired.length === 0) kernl.mount(plan, iframe);
```

## Composition

`createKernl(options)` runs once per page and performs these steps in order (`kernl.ts`). Anything the host passes in `KernlOptions` is used as is; anything missing is created with kernl's defaults.

1. **Event layer.** `options.eventStore ?? new EventStore()`, `options.pool ?? new RelayPool()`, `options.accounts ?? createKernlAccounts(host.storage)`. A pool the shell created itself is closed by `destroy()`; a supplied pool is left open.
2. **Relay tiers.** `createRelayTiers(host.storage, options.relays ?? {})`. Persisted choices at `kernl:relays:v1` win over `options.relays`, which only overrides `DEFAULT_RELAY_TIERS` on a fresh device.
3. **Registries.** `options.messaging ?? createDefaultMessaging({ storage: host.storage, backends: options.messagingBackends })` and `options.bridges ?? createDefaultBridges()`. The default bridge registry has no `authorize` hook, so in the composed shell a resource request is checked only by the HTTP bridge's SSRF policy and the applet's `resource` grant.
4. **Guard pipeline.** `createGuardPipeline` with `createGuardConfig(options.guard?.profile ?? 'strict')`, the host's `now` when given, `onEvent` feeding `kernl.guard.events$`, `getVisibility` delegated to `host.getVisibility`, and `onQuarantine` marking the handle revoked with reason `quarantine` and calling `bridge.revokeNapplet(windowId, 'host')`.
5. **Services.** `createKernlServices` registers `relay`, `identity`, `theme`, `notify`, `link`, `resource`, `dm` and `outbox` over the pool, the tiers, the event store, the active signer, the consent gate, the host, the bridge registry and the messaging registry. The `outbox` service is wrapped so that `outbox.publish` passes the consent gate first, because kehto's outbox service signs without naming the window. `options.theme` is used only when `isTheme` accepts it. `resolveIdentity` maps a live window to its verified identity so the resource service names the requesting applet to the bridges.
6. **ShellAdapter.** `createShellAdapter` builds kehto's adapter from the relay-pool hooks, the relay-config hooks over the tiers, `createAuthHooks(accounts, consent)`, the service registry, `capabilities.resolveEnvironment` from `createEnvironmentResolver(grants)`, `onNappletRevoked` (removes the frame through the handle) and `onNappletMessage` (feeds `pipeline.observe`). Choices kehto left open are fixed here: applets cannot create windows (`createWindow` returns null), hotkeys are not forwarded, there is no worker relay, update behaviour is `banner`, signatures are verified by applesauce's `verifyEvent`, `link.isAvailable` is true and `getNip66Suggestions` is null.
7. **Bridge.** `createShellBridge(adapter)`, unchanged ([D-001](../decisions.md#d-001)).
8. **Grants.** `createGrants({ acl: bridge.runtime.aclState, storage: host.storage, availableDomains: () => buildShellCapabilities(adapter).domains })`. The grants layer writes kehto's ACL explicitly for every applet, see [Grants](#grants).
9. **Consent.** Before steps 5 and 6, `lookupReplaceable(eventStore, { loader: createReplaceableLoader(eventStore, pool, tiers), relays: () => [...outbox, ...discovery] })` builds the before lookup and `createSigningConsent({ host, lookupBefore, resolveApplet: identityOf, pubkey })` builds the gate, and both of the routes an applet's write can take pass through it: `relay.publish` is signed through `ShellAdapter.auth.getSigner(windowId)`, whose `signEvent` calls the gate first, and `outbox.publish` is gated in the outbox service wrapper before kehto signs it. For a kind `isDestructiveKind` accepts (every replaceable and addressable kind, 5 and 62), the gate describes the draft against the current version, from the event store or else from the outbox and discovery relays within `CURRENT_VERSION_TIMEOUT_MS`, calls `host.presentConsent` and waits; anything but yes rejects with `denied:consent` and nothing is signed. Routine kinds are not prompted; the shell's own signing (no window) is not gated; answers are not remembered. kehto's runtime has no destructive-signing consent of its own. Separately, `bridge.registerConsentHandler(createConsentHandler(host, lookupBefore, identityOf))` answers kehto's own `ConsentRequest`, which the runtime raises only for a firewall `prompt` policy and without an event, so the handler refuses it without asking.
10. **Session.** `accounts.active$` drives `session$` (`toSession(account)` or null) and calls `bridge.publishIdentityChanged(pubkey)` with the active pubkey or `''` on sign-out, so bound applets hear every identity change through kehto's live port.
11. **Lifecycle.** `createAppletLifecycle` with `options.artifactCache ?? openDefaultArtifactCache` and `host.fetchBlob ?? defaultFetchBlob`.

`destroy()` closes every open applet, unsubscribes the session subscription, disposes the dm service, destroys the bridge and closes the pool if the shell owns it.

### The `KernlHost` contract

The host is the only way the core reaches the user or the page. Applets never reach these hooks.

| Member | Called when |
| --- | --- |
| `storage: StorageLike` | Every persisted value: accounts (`kernl:accounts:v1`, `kernl:active-account:v1`), relay tiers (`kernl:relays:v1`), grants (`kernl:grants:v1`), messaging preferences (`kernl:messaging:v1`). `localStorage` satisfies it; tests use a `Map`. |
| `presentConsent(prompt)` | An applet window asked the shell to sign, through `relay.publish` or `outbox.publish`, an event whose kind is destructive. `prompt.summary` is a `ConsentSummary` whose `event` is the unsigned draft (empty `id` and `sig`); `prompt.resolve(true)` signs, `prompt.resolve(false)` (also on dismiss) makes the signer throw `denied:consent`. The core never times a prompt out. |
| `notify(notice)` | An applet calls `notify.send`, or the guard has something to say. `notice.tone` is `info` or `warning`; `windowId` names the applet when there is one. |
| `openLink(url)` | An applet's `link.open` passed the link policy (`LINK_PROTOCOLS`: `https:` and `mailto:` only). |
| `getVisibility(windowId)` | Current visibility for a window, when the core needs it synchronously: the guard asks the first time it meets a window that `handle.setVisibility` has not reported on yet, and keeps that answer until the next `setVisibility`. |
| `onRevoked(windowId, reason)` | The core removed a frame because the bridge revoked its binding, or the guard quarantined it (`reason` is `quarantine`). |
| `fetchBlob?(sha256, servers)` | Optional. Replaces `defaultFetchBlob` for artifact bytes; the bytes are hashed by kehto either way. |
| `now?()` | Optional clock for the guard. |

### The `Kernl` surface

| Member | What it is |
| --- | --- |
| `accounts`, `eventStore`, `pool`, `bridge` | The applesauce `AccountManager`, `EventStore` and `RelayPool`, and kehto's `ShellBridge`. The web shell hides all but `accounts` from its UI. |
| `guard: GuardFacade` | `config`, `profile$`, `setProfile(profile)`, `events$`, `mitigations()`, `release(windowId)`. `setProfile` rebuilds kernl's guard layers shell-wide; held window-level messages are dropped and counters restart. Open windows keep the runtime firewall rates they were mounted with. It is not persisted. |
| `grants: Grants` | The user-facing grants surface, see [Grants](#grants). |
| `relays: RelayTiers` | `get()`, `add(tier, url)`, `remove(tier, url)`, `changes$`. `add` throws `invalid:relay-url` for anything that is not `ws://` or `wss://`. |
| `messaging`, `bridges` | The registries the services read. |
| `session$`, `session` | `Session \| null`: `{ accountId, pubkey, label, readOnly }`. The label is the account's `metadata.name`, then `account.name`, then the abbreviated pubkey. |
| `login(account)` | Adds the account to the manager if it is not there, makes it active, returns its `Session`. `KernlAccountManager` refuses plaintext-key account types here. |
| `logout()` | Clears the active account. |
| `decodePointer(input)` | See [resolve → plan → mount](#resolve-→-plan-→-mount). |
| `resolve`, `plan`, `mount`, `applets()`, `handleWindowMessage(event)` | The applet lifecycle. |
| `destroy()` | Tears the shell down. |

### resolve → plan → mount

`decodePointer(input)` accepts `naddr1…`, `nevent1…`, `note1…`, a bare 64-hex event id, any of those behind a `nostr:` prefix, and plain coordinates in `<pubkey>:<kind>:<identifier>` or NIP-01 `<kind>:<pubkey>:<identifier>` order. Anything else throws `invalid:pointer`. The pointer says which event to fetch and nothing more.

`resolve(pointer)` fetches the manifest from the pointer's relay hints plus the `apps` tier (newest event wins for addresses), throws `unavailable:manifest` when nobody serves one, and verifies the manifest and artifact through kehto's `resolveNapplet`, with `host.fetchBlob` or `defaultFetchBlob` for the bytes and the artifact cache when the page has Cache Storage. Failures are rethrown as `unavailable:blob` or `invalid:<kehto code>` (`invalid:blob-hash-mismatch`, `invalid:invalid-signature`, …). The verified `index.html` is kept inside the lifecycle, keyed by identity; the caller gets an `AppletSummary` whose `requires` and `optional` are advisory.

`plan(summary)` throws `invalid:unresolved` for a summary this shell did not resolve. It calls `grants.ensure(identity)` so the ACL holds the applet's record, numbers the window `applet-1`, `applet-2`, … and returns a `MountPlan`: the environment from kehto's `resolveShellEnvironment` narrowed by the grants, the `srcdoc` with the guard's zero-network CSP and the namespace prelude inserted by `prepareNappletSrcdoc`, `sandbox: 'allow-scripts'`, and `missingRequired`, the required domains the environment does not include. The host decides what to do with `missingRequired`; the core mounts whatever it is given.

`mount(plan, frame)` runs in this order:

1. `applyRuntimeFirewallRules(bridge.runtime.firewallState, guard.config, dTag)` installs the profile's rates in kehto's runtime firewall for this applet.
2. Harden the frame: the `sandbox` attribute is set to exactly `allow-scripts`, replacing any tokens the host set; `denyNappletControllerAccess` when the frame has `getAttribute`, otherwise `allow` is set to `CONTROLLER_DENY_POLICY`.
3. `originRegistry.register(window, windowId, { dTag, aggregateHash })`.
4. `originRegistry.setEnvironment(window, plan.environment)`.
5. `bridge.observeFrame(frame, windowId)`, so a second load revokes the binding.
6. Assign `frame.srcdoc = plan.srcdoc`. The handle's status moves from `mounting` to `running` on the frame's first `load`.

A frame without a `contentWindow` throws `invalid:frame-detached`. `handle.close()` calls `bridge.revokeNapplet(windowId, 'host')`, unregisters the window, removes the frame and forgets the window in the guard; a revocation from the bridge (`window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed`, `host`) removes the frame, forgets the guard state and calls `host.onRevoked`. The frame is never reused. `handle.setVisibility(visibility)` feeds the guard's visibility gate.

`handleWindowMessage(event)` resolves the sending window from `originRegistry`, never from the message, and runs the guard pipeline in front of `bridge.handleMessage`. Messages from windows the shell does not know are forwarded unguarded so kehto can report them as unrouted.

### Messaging backends

`KernlOptions.messagingBackends` is a `MessagingBackendFactories`: `{ private?: () => MessagingBackend; legacy?: () => MessagingBackend; ratchet?: () => MessagingBackend }`. `createDefaultMessaging` registers all three providers and marks each whose factory is absent unavailable with the reason from `MESSAGING_UNAVAILABLE_REASONS`:

| Provider | Reason | Why |
| --- | --- | --- |
| `private` | `needs-local-key-signer` | kehto's sealed-message adapter wants the owner's raw secret key, which kernl never holds outside an applesauce signer. The host supplies a backend built from a signer it controls. |
| `legacy` | `not-implemented` | No backend exists in this draft. |
| `ratchet` | `no-runtime` | A double-ratchet runtime has to be supplied. |

`enable(id)` on an unavailable provider throws `unavailable:<reason>`. Preferences persist at `kernl:messaging:v1`.

```ts
import { MESSAGING_UNAVAILABLE_REASONS, createDefaultMessaging } from '@kernl/core';
import type { MessagingBackend } from '@kernl/messaging';

declare const sealedBackend: () => MessagingBackend;

const messaging = createDefaultMessaging({ storage: localStorage, backends: { private: sealedBackend } });
messaging.get('legacy')?.availability; // { available: false, reason: MESSAGING_UNAVAILABLE_REASONS.legacy }
```

### Accounts

`createKernlAccounts(storage)` returns a `KernlAccountManager` with applesauce's common account types registered, state restored from `kernl:accounts:v1` and `kernl:active-account:v1`, and every later change persisted. `KernlAccountManager.addAccount` throws `denied:plaintext-key-persistence` for the types in `PLAINTEXT_KEY_ACCOUNT_TYPES`, `['nsec', 'seed-words']`: `PrivateKeyAccount` serialises the key itself and `SeedWordsAccount` the mnemonic. Any such entry found in storage is dropped on restore. The only persisted form of a local key is applesauce's `PasswordAccount`, whose `ncryptsec` is NIP-49 encrypted.

`createAuthHooks(accounts, consent)` is kehto's `AuthHooks`: `getUserPubkey` is the active pubkey or null; `getSigner(windowId?)` is null while nobody is signed in and for read-only accounts, so the runtime refuses writes instead of failing inside a signer. With a `windowId`, the returned signer's `signEvent` awaits `consent(windowId, template)` before the account signs; without one it is the account's signer, ungated. `wrapAccountSigner(account)` exposes `getPublicKey`, `signEvent` and the `nip04`/`nip44` namespaces the account has, never the account.

### Relay tiers

`DEFAULT_RELAY_TIERS`, used when nothing is persisted and `options.relays` says nothing for a tier:

| Tier | Default | Serves |
| --- | --- | --- |
| `discovery` | `wss://purplepag.es`, `wss://relay.nos.social` | kinds 0, 3 and 10002 |
| `apps` | `wss://relay.napplet.soy` | applet manifests (the NIP-5D kinds and 32267) |
| `outbox` | none | the user's own relays, merged with `super` for everything else |
| `super` | `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.primal.net` | everything else |

`selectRelayTier(tiers, filters)` routes a filter set to `discovery` when every kind is a discovery kind, to `apps` when every kind is an applet kind, and to `super` plus `outbox` (deduplicated) otherwise, including filters without kinds. kehto's `RelayConfigHooks` sees `discovery`, `super` and `outbox`; `apps` is kernl's addition.

### Grants

`BASELINE_DOMAINS` is `['shell', 'inc', 'theme', 'identity', 'storage']`: every applet gets the handshake, in-shell messaging, the theme, a read-only view of the identity and scoped storage, and no network. `DOMAIN_CAPABILITIES` maps each NAP domain to the kehto capabilities it needs:

| Domain | Capabilities |
| --- | --- |
| `shell`, `inc` | none |
| `relay` | `relay:read`, `relay:write` |
| `identity` | `identity:read` |
| `storage` | `state:read`, `state:write` |
| `theme` | `theme:read` |
| `keys` | `keys:bind`, `keys:forward` |
| `media` | `media:control` |
| `notify` | `notify:send`, `notify:channel` |
| `config` | `config:read` |
| `resource` | `resource:fetch` |
| `cvm` | `cvm:call` |
| `outbox` | `outbox:read`, `outbox:write` |
| `upload` | `upload:write` |
| `intent` | `intent:read`, `intent:write` |
| `dm` | `dm:read`, `dm:write` |
| `fs` | `fs:read`, `fs:write` |
| `llm` | `llm:generate` |
| `cache` | `cache:read`, `cache:write` |

Unknown domains need no capability (`capabilitiesForDomain('made-up')` is `[]`). `createGrants` keeps a per-identity record `{ dTag, hash, domains, blocked }` at `kernl:grants:v1` and, on every commit, writes the whole capability set into kehto's ACL: every capability in `ALL_CAPABILITIES` is granted when a baseline or allowed domain needs it and revoked otherwise, then `block`/`unblock` is applied and the ACL persisted. `KernlGrants.ensure(identity)` does this for an applet that has no record yet; `plan` calls it. `createEnvironmentResolver(grants)` is the `capabilities.resolveEnvironment` hook: each applet sees the baseline plus its allowed domains, intersected with what the shell offers; a blocked applet sees only `shell`. The calls are in [Grant and revoke](../how-tos/grant-and-revoke.md).

### Consent summaries

`describeChange(event, before, applet)` turns a write into a `ConsentSummary` with a `title`, a `severity` and `lines` of `{ label, before?, after? }`:

| Kind | Severity | Title | Lines |
| --- | --- | --- | --- |
| `0` | `destructive` | Update your profile | One line per changed field among name, display name, about, picture, banner, verified address, payment address and website; or "No profile fields change". |
| `3` | `destructive` | Change who you follow | "Follows added" and "Follows removed" with counts and the first three pubkeys abbreviated; or "No entries change". |
| `5` | `destructive` | Delete N event(s) | One "Delete" line per `e` tag, abbreviated, and one "Delete every version of" line per `a` tag, naming the address as `kind:pubkey…:identifier`. |
| `62` | `destructive` | Ask services to erase your account | "Erase: Everything this account has published" and "Services asked": every service when the `relay` tags are absent or include `ALL_RELAYS`, else the first three named. |
| `10002` | `destructive` | Change your connections list | "Connections added" and "Connections removed" with read/write markers. |
| 10000–10099, 30000–30099 | `destructive` | Change the list "title or d tag", or "Change a list" | "Entries added" and "Entries removed" as `tag:value`. |
| any other replaceable (10100–19999) or addressable (30100–39999) kind | `destructive` | Replace your kind N event, with the `title` or `d` tag in quotes when there is one | "Entries added" and "Entries removed" over the tags other than `d`, `title` and `description`, and "Content: Replaced" when the content differs, without copying it. |
| anything else | `routine` | Publish a note, repost, reaction, comment, article, sealed message, legacy private message, payment receipt, or "kind N event" | One "Content" line with a 140-character preview. |

`isDestructiveKind(kind)` is true for exactly the `destructive` rows: every replaceable kind (0, 3, 10000–19999), every addressable kind (30000–39999), 5 and 62.

`LookupBefore` is `(kind, pubkey, identifier?) => Promise<NostrEvent | undefined>`. `lookupReplaceable(store, options?)` builds one: the store answers first; on a miss, and only when `options.loader` is given, the applesauce address loader asks `options.relays()` and the lookup waits at most `options.timeoutMs` (default `CURRENT_VERSION_TIMEOUT_MS`, 4000 ms) and takes the newest version that arrived. A loader that fails or stays silent yields `undefined`. When a replaceable or addressable write is described and no current version was found, the summary's first line is `UNKNOWN_CURRENT_VERSION`, "Current version: could not be loaded; this replaces it entirely", so it never reads as a first version that removes nothing.

`createSigningConsent(options)` returns the `SigningConsent` gate, `(windowId, template) => Promise<void>`: it resolves at once for a routine kind; for a destructive one it builds an unsigned draft (empty `id` and `sig`; this draft is the summary's `event`), describes it against `lookupBefore`, and resolves only when `host.presentConsent` answers yes. It rejects with `denied:consent` when the user refuses, `denied:unknown-applet` for a destructive write from a window the shell did not mount, `denied:signed-out` for a destructive write while nobody is signed in, and `invalid:event-kind` when the kind is not a number.

`createConsentHandler(host, lookupBefore, resolveApplet)` answers kehto's own `ConsentRequest`. The kehto runtime kernl pins raises only `firewall-policy` requests, which carry no event, and the handler refuses those without asking. A request that does carry an event, from a window the shell can name, would be described and put to the user, so a later kehto release that adds such prompts is answered honestly; one from an unknown window is refused.

### Layouts

Pure `LayoutStrategy` values over `@kehto/wm` types. Minimised windows are never arranged.

| Export | Behaviour |
| --- | --- |
| `floatingLayout` | Every window keeps its rectangle. |
| `createDwindleLayout({ gap? })` | Each window after the first takes half the remaining area, splitting vertically then horizontally in turn. |
| `createColumnsLayout({ gap? })` | Equal-width columns in window order. |
| `createMasterStackLayout({ ratio?, gap? })` | The focused window (or the first) takes `ratio` of the width (default 0.6) on the left; the rest stack on the right. |

```ts
import { createMasterStackLayout } from '@kernl/core';
import type { WindowState } from '@kehto/wm';

declare const windows: WindowState[];

createMasterStackLayout({ ratio: 0.5, gap: 8 }).arrange(windows, { x: 0, y: 0, w: 1200, h: 800 });
```

## Exports

Signatures are abbreviated; the generated reference has the full ones.

### Composition

| Export | Signature | Description |
| --- | --- | --- |
| `createKernl` | `(options: KernlOptions) => Kernl` | The composition root described above. |
| `toSession` | `(account: IAccount) => Session` | Describes an account for the UI; `readOnly` when it cannot sign. |
| `createAppletLifecycle` | `(context: LifecycleContext) => AppletLifecycle` | `resolve`, `plan`, `mount`, `applets`, `handleWindowMessage` over the composed parts. |
| `resolveWindow` | `(handles: ReadonlyMap<string, MountedApplet>, event: MessageEvent) => WindowResolution \| null` | The sending window from `originRegistry`, never from the message. |
| `createShellAdapter` | `(deps: ShellAdapterDeps) => ShellAdapter` | kehto's adapter from kernl's parts, with the fixed choices listed under Composition. `deps.consent` (a `SigningConsent`) is required. |
| `createKernlServices` | `(deps: KernlServiceDeps) => KernlServices` | `{ registry, theme, dm }` with kehto's eight reference services wired. `deps.consent` is required; `outbox.publish` passes it before signing, and a refusal is answered as `outbox.publish.result` with `ok: false` and the reason. |
| `isTheme` | `(value: Record<string, unknown> \| undefined) => value is Theme` | True when `colors.background`, `colors.text` and `colors.primary` are strings. |
| `resourceInitFor` | `(deps, init: ResourceFetchInit) => ResourceResolveInit` | Names the requesting applet, or `'shell'`, to the bridge resolver. |
| `LINK_PROTOCOLS` | `readonly string[]` | `['https:', 'mailto:']`. |
| `PACKAGE_NAME` | `'@kernl/core'` | |
| `KERNL_FRAME_POLICY_META` | `string` | kehto's `<meta>` for the host page's `<head>`, so applet frames cannot navigate away from their `srcdoc`. |
| `Kernl`, `KernlOptions`, `KernlHost`, `GuardFacade`, `Session`, `StorageLike`, `MessagingBackendFactories`, `AppletLifecycle`, `LifecycleContext`, `ShellAdapterDeps`, `KernlServiceDeps`, `KernlServices` | types | |

### Applets

| Export | Signature | Description |
| --- | --- | --- |
| `decodePointer` | `(input: string) => AppletPointer` | Address text to `{ kind: 'address' \| 'event', … }`; throws `invalid:pointer`. |
| `fetchManifestEvent` | `(pool: ApplesaucePool, tiers: RelayTiers, pointer: AppletPointer) => Promise<NostrEvent>` | Newest manifest from the hints plus the `apps` tier; throws `unavailable:manifest`. |
| `defaultFetchBlob` | `(sha256: string, servers: readonly string[], fetchImpl?: typeof fetch) => Promise<Uint8Array>` | Tries each server with a `BLOB_TIMEOUT_MS` (20 000 ms) budget; throws `unavailable:blob`. |
| `openDefaultArtifactCache` | `() => Promise<NappletArtifactCache \| undefined>` | kehto's verified-artifact cache over Cache Storage, or nothing. |
| `resolveApplet` | `(options: ResolveAppletOptions) => Promise<ResolvedApplet>` | kehto's `resolveNapplet` with kernl's reasons: `unavailable:blob` or `invalid:<code>`. |
| `summarize` | `(resolved: ResolvedNapplet) => AppletSummary` | The verified manifest reduced to what the shell shows. |
| `planMount` | `(options: PlanMountOptions) => MountPlan` | Environment, CSP-prepared `srcdoc`, `missingRequired`. No DOM. |
| `mountApplet` | `(plan: MountPlan, frame: FrameLike, deps: MountDeps) => MountedApplet` | The NIP-5D mount order; throws `invalid:frame-detached`. Calls `frame.setAttribute('sandbox', 'allow-scripts')`. |
| `CONTROLLER_DENY_POLICY` | `string` | `gamepad 'none'; hid 'none'; usb 'none'`. |
| `BLOB_TIMEOUT_MS` | `20_000` | |
| `AppletPointer`, `AppletSummary`, `AppletIdentity`, `MountPlan`, `AppletHandle`, `AppletStatus`, `FrameLike`, `ResolveAppletOptions`, `ResolvedApplet`, `PlanMountOptions`, `MountDeps`, `MountGuardHooks`, `MountedApplet` | types | `MountedApplet` adds `revoked(reason)` to `AppletHandle` for the bridge's revocation hook. `FrameLike.sandbox` is optional and not read: the mount replaces the attribute whatever it held. |

### Guard

| Export | Signature | Description |
| --- | --- | --- |
| `createGuardPipeline` | `(options: GuardPipelineOptions) => GuardPipeline` | Ingress guard, visibility gate and focus firewall in front of the bridge; `handleWindowMessage` for window-level messages, `observe` for port traffic. |
| `runtimeFirewallRules` | `(config: GuardConfig, napplet: string) => RuntimeFirewallRules` | The profile's per-class rates translated to the runtime's capability keys, plus the global rate. |
| `applyRuntimeFirewallRules` | `(firewallState, config: GuardConfig, napplet: string) => void` | Installs those rules in `bridge.runtime.firewallState` with policy `allow` and persists. |
| `RUNTIME_OP_CLASSES` | `Readonly<Record<OpClass, string \| null>>` | Guard class to runtime key; `null` for `relay:publish:delete`, `control` and `generic`. See [Guard](../concepts/guard.md#where-enforcement-happens). |
| `GuardPipeline`, `GuardPipelineOptions`, `PipelineDisposition`, `WindowResolution`, `RuntimeFirewallRules`, `RuntimeRateRule` | types | `PipelineDisposition` is `GuardDisposition \| 'unrouted'`. |

### Grants and consent

| Export | Signature | Description |
| --- | --- | --- |
| `createGrants` | `(options: GrantsOptions) => KernlGrants` | The grants surface over `bridge.runtime.aclState`, persisted at `kernl:grants:v1`. |
| `createEnvironmentResolver` | `(grants: Grants) => CapabilityHooks['resolveEnvironment']` | Baseline plus allowed domains; `shell` only when blocked. |
| `BASELINE_DOMAINS` | `readonly string[]` | `['shell', 'inc', 'theme', 'identity', 'storage']`. |
| `DOMAIN_CAPABILITIES` | `Readonly<Record<string, readonly Capability[]>>` | The table above. |
| `capabilitiesForDomain` | `(domain: string) => readonly Capability[]` | Empty for unknown domains. |
| `capabilitiesForDomains` | `(domains: readonly string[]) => readonly Capability[]` | Union in table order. |
| `describeChange` | `(event: NostrEvent, before: NostrEvent \| undefined, applet: AppletIdentity) => ConsentSummary` | The kind table above. |
| `isDestructiveKind` | `(kind: number) => boolean` | True for every replaceable kind (0, 3, 10000–19999), every addressable kind (30000–39999), 5 and 62. |
| `createSigningConsent` | `(options: SigningConsentOptions) => SigningConsent` | The gate both signing routes pass; see [Consent summaries](#consent-summaries). |
| `abbreviate` | `(hex: string) => string` | First eight characters and an ellipsis. |
| `createConsentHandler` | `(host: Pick<KernlHost, 'presentConsent'>, lookupBefore: LookupBefore, resolveApplet: ResolveAppletIdentity) => (request: ConsentRequest) => void` | For `bridge.registerConsentHandler`. |
| `lookupReplaceable` | `(store: Pick<EventStore, 'getReplaceable'>, options?: LookupReplaceableOptions) => LookupBefore` | Finds the current version for the diff: the store first, then `options.loader` over `options.relays()` for up to `options.timeoutMs`. |
| `LookupReplaceableOptions` | interface | `{ loader?: AddressPointerLoader; relays?: () => readonly string[]; timeoutMs?: number }`. Without `loader` the lookup reads the store only. |
| `CURRENT_VERSION_TIMEOUT_MS` | `4000` | How long a consent prompt waits for the network to return the current version. |
| `UNKNOWN_CURRENT_VERSION` | `ConsentLine` | `{ label: 'Current version', after: 'could not be loaded; this replaces it entirely' }`, the first line of a destructive summary whose current version was not found. |
| `Grants`, `GrantRecord`, `KernlGrants`, `GrantsOptions`, `ConsentSummary`, `ConsentLine`, `ConsentPrompt`, `LookupBefore`, `ResolveAppletIdentity`, `SigningConsent`, `SigningConsentOptions`, `SigningTemplate` | types | `GrantRecord` is `{ identity, domains, capabilities, blocked, stateQuotaBytes }`. |

### Applesauce adapters

| Export | Signature | Description |
| --- | --- | --- |
| `createKernlAccounts` | `(storage: StorageLike) => AccountManager` | A `KernlAccountManager` with common types registered and persistence wired. |
| `KernlAccountManager` | class extends `AccountManager` | `addAccount` throws `denied:plaintext-key-persistence` for plaintext-key types. |
| `PLAINTEXT_KEY_ACCOUNT_TYPES` | `readonly string[]` | `['nsec', 'seed-words']`. |
| `createAuthHooks` | `(accounts: AccountManager, consent: SigningConsent) => AuthHooks` | kehto's auth over the account manager; a signer asked for with a window id passes `consent` before signing. |
| `wrapAccountSigner` | `(account: IAccount) => Signer` | The NIP-07-shaped signer kehto expects. |
| `isReadOnlyAccount` | `(account: IAccount) => boolean` | True for `ReadonlyAccount`. |
| `createReplaceableLoader` | `(store: EventStore, pool: ApplesaucePool, tiers: RelayTiers) => AddressPointerLoader` | The applesauce address loader for replaceable and addressable events the store lacks: it asks the pointer's relays, then the `discovery` tier, and adds what it finds to the store. Used by `createIdentityProviders` and the consent lookup. |
| `createIdentityProviders` | `(store: EventStore, pool: ApplesaucePool, tiers: RelayTiers, options?: IdentityProviderOptions) => IdentityProviders` | Profile, follows, mutes and relays from the store, loaded once from the `discovery` tier on a miss; lists, zaps, blocked and badges are empty. |
| `createRelayPoolHooks` | `(pool: ApplesaucePool, tiers: RelayTiers) => RelayPoolHooks` | kehto's relay-pool hooks, including one scoped relay per window. |
| `createRelayPoolLike` | `(pool: ApplesaucePool) => RelayPoolLike` | `subscription`, `request`, `publish` over the one pool. |
| `createAppletRelayBackend` | `(pool: ApplesaucePool, tiers: RelayTiers) => RelayPoolServiceOptions` | For kehto's `createRelayPoolService`; publishes go to the tier for the event's kind. |
| `createDmRelayPool` | `(pool: ApplesaucePool, tiers: RelayTiers) => DmRelayPool` | For messaging backends. |
| `createOutboxRelayPool` | `(pool: ApplesaucePool) => OutboxRelayPoolLike` | For kehto's `createRelayPoolOutboxRouter`, with per-relay publish outcomes. |
| `subscribeWithEose` | `(pool, relays: string[], filters: NostrFilter[], callback: (item: NostrEvent \| 'EOSE') => void) => EoseSubscription` | Each event once, one `EOSE` after every relay answered or failed. |
| `selectRelayTier` | `(tiers: RelayTiers, filters: readonly NostrFilter[]) => string[]` | The routing rule under Relay tiers. |
| `createRelayTiers` | `(storage: StorageLike, defaults?: Partial<Record<RelayTier, readonly string[]>>) => RelayTiers` | Persisted at `kernl:relays:v1`; `changes$` replays the current value. |
| `DEFAULT_RELAY_TIERS` | `Readonly<Record<RelayTier, readonly string[]>>` | The table above. |
| `ApplesaucePool`, `EoseSubscription`, `OutboxRelayPoolLike`, `IdentityProfile`, `IdentityProviderOptions`, `IdentityProviders`, `RelayPermissions`, `RelayTier`, `RelayTiers` | types | `ApplesaucePool` is `Pick<RelayPool, 'req' \| 'request' \| 'publish'>` so tests can supply a fake. |

### Registries, layouts and persistence

| Export | Signature | Description |
| --- | --- | --- |
| `createDefaultMessaging` | `(options: DefaultMessagingOptions) => MessagingRegistry` | The three providers, available only when their backend factory is supplied. |
| `MESSAGING_UNAVAILABLE_REASONS` | `Readonly<Record<'private' \| 'legacy' \| 'ratchet', string>>` | `needs-local-key-signer`, `not-implemented`, `no-runtime`. |
| `createDefaultBridges` | `(options?: DefaultBridgesOptions) => BridgeRegistry` | The HTTP bridge plus torrent, nzb, soulseek and mail, which report `no-backend` ([D-010](../decisions.md#d-010)). `options.http` goes to the HTTP bridge; the rest to the registry. |
| `floatingLayout`, `createDwindleLayout`, `createColumnsLayout`, `createMasterStackLayout` | `LayoutStrategy` and `(options?) => LayoutStrategy` | The layouts above. |
| `createNamespacedStore` | `(storage: StorageLike, prefix: string) => NamespacedStore` | `getJson`, `setJson`, `remove` under `<prefix>:`; corrupt JSON reads as the fallback. |
| `DefaultMessagingOptions`, `DefaultBridgesOptions`, `LayoutOptions`, `MasterStackOptions`, `NamespacedStore` | types | |

## Scope

- Composes; does not re-implement a kehto primitive. Local layers exist only where `ShellAdapter` or `createRuntime` has no hook, and each is named in [Alpha status](../alpha-status.md#upstream-gaps).
- Imports events, relays, signing and accounts from applesauce only. `nostr-tools` is a transitive peer and `pnpm check:deps` fails if it is imported.
- Holds no UI. `apps/web` supplies the iframe, the visibility, the prompts and the notices through `KernlHost`.
- Serialises no private key. `PasswordAccount` is the only persisted form of a local key and it is applesauce's.

## API reference

Generated module: [`_kernl_core`](../api/modules/_kernl_core.html){target="_self"}
