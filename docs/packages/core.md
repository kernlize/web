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

This is where the five opinions in `SOUL.md` become code. `createKernl` builds one `EventStore`, one `RelayPool` and one `AccountManager`, adapts them to kehto's relay, auth and dm contracts, registers kehto's reference services, builds the `ShellAdapter` and hands it to `createShellBridge`, puts the guard pipeline in front of the bridge, and exposes the applet lifecycle (`decodePointer` → `resolve` → `plan` → `mount`), the grants surface, consent summaries and layouts to the shell app. The layering is in [Architecture](../concepts/architecture.md).

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
5. **Services.** `createKernlServices` registers `relay`, `identity`, `theme`, `notify`, `link`, `resource`, `dm` and `outbox` over the pool, the tiers, the event store, the active signer, the host, the bridge registry and the messaging registry. `options.theme` is used only when `isTheme` accepts it. `resolveIdentity` maps a live window to its verified identity so the resource service names the requesting applet to the bridges.
6. **ShellAdapter.** `createShellAdapter` builds kehto's adapter from the relay-pool hooks, the relay-config hooks over the tiers, `createAuthHooks(accounts)`, the service registry, `capabilities.resolveEnvironment` from `createEnvironmentResolver(grants)`, `onNappletRevoked` (removes the frame through the handle) and `onNappletMessage` (feeds `pipeline.observe`). Choices kehto left open are fixed here: applets cannot create windows (`createWindow` returns null), hotkeys are not forwarded, there is no worker relay, update behaviour is `banner`, signatures are verified by applesauce's `verifyEvent`, `link.isAvailable` is true and `getNip66Suggestions` is null.
7. **Bridge.** `createShellBridge(adapter)`, unchanged ([D-001](../decisions.md#d-001)).
8. **Grants.** `createGrants({ acl: bridge.runtime.aclState, storage: host.storage, availableDomains: () => buildShellCapabilities(adapter).domains })`. The grants layer writes kehto's ACL explicitly for every applet, see [Grants](#grants).
9. **Consent.** `bridge.registerConsentHandler(createConsentHandler(host, lookupReplaceable(eventStore), identityOf))`, so every destructive-signing request kehto raises reaches `host.presentConsent` as a `ConsentSummary`.
10. **Session.** `accounts.active$` drives `session$` (`toSession(account)` or null) and calls `bridge.publishIdentityChanged(pubkey)` with the active pubkey or `''` on sign-out, so bound applets hear every identity change through kehto's live port.
11. **Lifecycle.** `createAppletLifecycle` with `options.artifactCache ?? openDefaultArtifactCache` and `host.fetchBlob ?? defaultFetchBlob`.

`destroy()` closes every open applet, unsubscribes the session subscription, disposes the dm service, destroys the bridge and closes the pool if the shell owns it.

### The `KernlHost` contract

The host is the only way the core reaches the user or the page. Applets never reach these hooks.

| Member | Called when |
| --- | --- |
| `storage: StorageLike` | Every persisted value: accounts (`kernl:accounts:v1`, `kernl:active-account:v1`), relay tiers (`kernl:relays:v1`), grants (`kernl:grants:v1`), messaging preferences (`kernl:messaging:v1`). `localStorage` satisfies it; tests use a `Map`. |
| `presentConsent(prompt)` | kehto asks for consent on a destructive signing kind. `prompt.summary` is a `ConsentSummary`; call `prompt.resolve(false)` on dismiss. The core never times a prompt out. |
| `notify(notice)` | An applet calls `notify.send`, or the guard has something to say. `notice.tone` is `info` or `warning`; `windowId` names the applet when there is one. |
| `openLink(url)` | An applet's `link.open` passed the link policy (`LINK_PROTOCOLS`: `https:` and `mailto:` only). |
| `getVisibility(windowId)` | The guard meets a window it has not been told about yet. |
| `onRevoked(windowId, reason)` | The core removed a frame because the bridge revoked its binding, or the guard quarantined it (`reason` is `quarantine`). |
| `fetchBlob?(sha256, servers)` | Optional. Replaces `defaultFetchBlob` for artifact bytes; the bytes are hashed by kehto either way. |
| `now?()` | Optional clock for the guard. |

### The `Kernl` surface

| Member | What it is |
| --- | --- |
| `accounts`, `eventStore`, `pool`, `bridge` | The applesauce `AccountManager`, `EventStore` and `RelayPool`, and kehto's `ShellBridge`. The web shell hides all but `accounts` from its UI. |
| `guard: GuardFacade` | `config`, `profile$`, `setProfile(profile)`, `events$`, `mitigations()`, `release(windowId)`. `setProfile` rebuilds every guard layer shell-wide; held messages are dropped and counters restart. It is not persisted. |
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
2. Harden the frame: `sandbox` becomes exactly `allow-scripts`; `denyNappletControllerAccess` when the frame has `getAttribute`, otherwise `allow` is set to `CONTROLLER_DENY_POLICY`.
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
messaging.get('legacy')?.availability(); // { available: false, reason: MESSAGING_UNAVAILABLE_REASONS.legacy }
```

### Accounts

`createKernlAccounts(storage)` returns a `KernlAccountManager` with applesauce's common account types registered, state restored from `kernl:accounts:v1` and `kernl:active-account:v1`, and every later change persisted. `KernlAccountManager.addAccount` throws `denied:plaintext-key-persistence` for the types in `PLAINTEXT_KEY_ACCOUNT_TYPES`, `['nsec', 'seed-words']`: `PrivateKeyAccount` serialises the key itself and `SeedWordsAccount` the mnemonic. Any such entry found in storage is dropped on restore. The only persisted form of a local key is applesauce's `PasswordAccount`, whose `ncryptsec` is NIP-49 encrypted.

`createAuthHooks(accounts)` is kehto's `AuthHooks`: `getUserPubkey` is the active pubkey or null; `getSigner` is null while nobody is signed in and for read-only accounts, so the runtime refuses writes instead of failing inside a signer. `wrapAccountSigner(account)` exposes `getPublicKey`, `signEvent` and the `nip04`/`nip44` namespaces the account has, never the account.

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
| `5` | `destructive` | Delete N event(s) | One "Delete" line per `e` tag, abbreviated. |
| `10002` | `destructive` | Change your connections list | "Connections added" and "Connections removed" with read/write markers. |
| 10000–10099, 30000–30099 | `destructive` | Change the list "title or d tag", or "Change a list" | "Entries added" and "Entries removed" as `tag:value`. |
| anything else | `routine` | Publish a note, repost, reaction, comment, article, sealed message, legacy private message, payment receipt, or "kind N event" | One "Content" line with a 140-character preview. |

`createConsentHandler(host, lookupBefore, resolveApplet)` adapts kehto's `ConsentRequest`: it looks up the current replaceable event through `lookupReplaceable(eventStore)` for the diff, asks the host, and refuses without asking when the request has no event (kehto's `firewall-policy` prompt) or comes from a window the shell cannot name.

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
| `createShellAdapter` | `(deps: ShellAdapterDeps) => ShellAdapter` | kehto's adapter from kernl's parts, with the fixed choices listed under Composition. |
| `createKernlServices` | `(deps: KernlServiceDeps) => KernlServices` | `{ registry, theme, dm }` with kehto's eight reference services wired. |
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
| `mountApplet` | `(plan: MountPlan, frame: FrameLike, deps: MountDeps) => MountedApplet` | The NIP-5D mount order; throws `invalid:frame-detached`. |
| `CONTROLLER_DENY_POLICY` | `string` | `gamepad 'none'; hid 'none'; usb 'none'`. |
| `BLOB_TIMEOUT_MS` | `20_000` | |
| `AppletPointer`, `AppletSummary`, `AppletIdentity`, `MountPlan`, `AppletHandle`, `AppletStatus`, `FrameLike`, `ResolveAppletOptions`, `ResolvedApplet`, `PlanMountOptions`, `MountDeps`, `MountGuardHooks`, `MountedApplet` | types | `MountedApplet` adds `revoked(reason)` to `AppletHandle` for the bridge's revocation hook. |

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
| `abbreviate` | `(hex: string) => string` | First eight characters and an ellipsis. |
| `createConsentHandler` | `(host: Pick<KernlHost, 'presentConsent'>, lookupBefore: LookupBefore, resolveApplet: ResolveAppletIdentity) => (request: ConsentRequest) => void` | For `bridge.registerConsentHandler`. |
| `lookupReplaceable` | `(store: Pick<EventStore, 'getReplaceable'>) => LookupBefore` | Finds the current replaceable event for the diff. |
| `Grants`, `GrantRecord`, `KernlGrants`, `GrantsOptions`, `ConsentSummary`, `ConsentLine`, `ConsentPrompt`, `LookupBefore`, `ResolveAppletIdentity` | types | `GrantRecord` is `{ identity, domains, capabilities, blocked, stateQuotaBytes }`. |

### Applesauce adapters

| Export | Signature | Description |
| --- | --- | --- |
| `createKernlAccounts` | `(storage: StorageLike) => AccountManager` | A `KernlAccountManager` with common types registered and persistence wired. |
| `KernlAccountManager` | class extends `AccountManager` | `addAccount` throws `denied:plaintext-key-persistence` for plaintext-key types. |
| `PLAINTEXT_KEY_ACCOUNT_TYPES` | `readonly string[]` | `['nsec', 'seed-words']`. |
| `createAuthHooks` | `(accounts: AccountManager) => AuthHooks` | kehto's auth over the account manager. |
| `wrapAccountSigner` | `(account: IAccount) => Signer` | The NIP-07-shaped signer kehto expects. |
| `isReadOnlyAccount` | `(account: IAccount) => boolean` | True for `ReadonlyAccount`. |
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
