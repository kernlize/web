# @kernlize/core

Opinionated shell composition over kehto and applesauce. Browser-agnostic: the DOM is reached only through the `KernlHost` hooks and the `FrameLike` shape, so the whole composition runs in vitest against fakes.

| Field | Value |
| --- | --- |
| npm | `@kernlize/core` |
| JSR | `@kernl/core` |
| Version | `0.12.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts`; `@kernlize/core/wm` (`@kernl/core/wm` on JSR) is `./dist/wm/index.js`, the layouts and the window manager without the network stack; `@kernlize/core/crypto` (`@kernl/core/crypto` on JSR) is `./dist/crypto/index.js`, the Web Crypto fallback |
| Dependencies | `@internet-privacy/marmot-ts ^0.9.0`; `@kehto/acl ^0.20.6`; `@kehto/firewall ^0.10.0`; `@kehto/nip ^0.8.0`; `@kehto/rate-limit ^0.2.0`; `@kehto/runtime ^0.30.1`; `@kehto/services ^0.34.0`; `@kehto/shell ^0.35.0`; `@kehto/wm ^0.0.2`; `@kernlize/bridges workspace:^`; `@kernlize/guard workspace:^`; `@kernlize/messaging workspace:^`; `@noble/ciphers ^2.4.0`; `@noble/curves ^2.4.0`; `@noble/hashes ^2.4.0`; `@sqlite.org/sqlite-wasm 3.54.1-build1`; `applesauce-accounts ^7.1.0`; `applesauce-common ^7.1.1`; `applesauce-core ^7.1.3`; `applesauce-loaders ^7.2.0`; `applesauce-relay ^7.1.1`; `applesauce-signers ^7.1.0`; `applesauce-sqlite ^7.1.0`; `blossom-client-sdk 5.1.0`; `nostr-double-ratchet ^0.0.187`; `rxjs ^7.8.2` |
| Peer dependencies | `@napplet/core >=0.41.0 <0.42.0`; `@napplet/nap >=0.37.0 <0.41.0`; `@napplet/shim >=0.30.0`; `nostr-tools >=2.23.3 <=2.x` |
| Side effects | none |

## Install

This package is `@kernlize/core` on npm and `@kernl/core` on JSR, the same code at the same version. Once released:

```sh
npm install @kernlize/core
# or
deno add jsr:@kernl/core
```

Neither registry has a release yet, so both commands fail. During the alpha the package is built from the kernl source repository, which is private, and consumed as a workspace dependency under its npm name. The [package index](./index.md#install) has the steps.

```json
{ "dependencies": { "@kernlize/core": "workspace:^" } }
```

## Purpose

This is where the five opinions in `SOUL.md` become code. `createKernl` builds one `EventStore`, one `RelayPool` and one `AccountManager`, adapts them to kehto's relay, auth and dm contracts, registers kehto's reference services, builds the `ShellAdapter` and hands it to `createShellBridge`, puts the guard pipeline in front of the bridge for the window-level `hello` and behind it, as an observer, for port traffic, wraps the account signer so destructive signatures ask the user first, and exposes the applet lifecycle (`decodePointer` → `resolve` → `plan` → `mount`), the grants surface, consent summaries and layouts to the shell app. The layering is in [Architecture](../concepts/architecture.md).

```ts
import { createKernl, type KernlHost } from '@kernlize/core';

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

1. **Event layer.** `options.eventStore ?? new EventStore()`, `options.pool ?? new RelayPool(SHELL_RELAY_OPTIONS)`, `options.accounts ?? createKernlAccounts(host.storage)`. A pool the shell created itself is closed by `destroy()`; a supplied pool is left open.
2. **Relay tiers.** `createRelayTiers(host.storage, options.relays ?? {})`. Persisted choices at `kernl:relays:v1` win over `options.relays`, which only overrides `DEFAULT_RELAY_TIERS` on a fresh device.
3. **Registries.** `options.messaging ?? createDefaultMessaging(...)`, with `createPrivateMessagesBackend` and `createLegacyMessagesBackend` as the `private` and `legacy` backends unless `options.messagingBackends` overrides them, and availability tracking the active account ([Messaging backends](#messaging-backends)), and `options.bridges ?? createDefaultBridges({ handoff: host.openLink, torrent: options.torrent })`, so downloads, sharing and mail hand off through the host's confirm-before-leaving opener and a `KernlOptions.torrent` backend, when given, downloads magnet links inside kernl instead ([D-017](../decisions.md#d-017)). The default bridge registry has no `authorize` hook, so in the composed shell a resource request is checked only by the HTTP bridge's SSRF policy and the applet's `resource` grant.
4. **Guard pipeline.** `createGuardPipeline` with `createGuardConfig(options.guard?.profile ?? 'strict')`, the host's `now` when given, `onEvent` feeding `kernl.guard.events$`, `getVisibility` delegated to `host.getVisibility`, `onQuarantine` marking the handle revoked with reason `quarantine` and calling `bridge.revokeNapplet(windowId, 'host')`, and `onRelease` calling `bridge.releaseDeferred(windowId)` when a window becomes visible.
5. **Services.** `createKernlServices` registers `relay`, `identity`, `theme`, `keys`, `notify`, `link`, `resource`, `dm`, `outbox` and `cvm` over the pool, the tiers, the event store, the active signer, the consent gate, the host, the bridge registry and the messaging registry. The `outbox` service is wrapped so that `outbox.publish` passes the consent gate first, because kehto's outbox service signs without naming the window. The `link` service calls `host.openLink(url, { approved: true })`, because kehto runs it only after the firewall let that exact link through; `resource` puts a web address's origin to the firewall through `fetchThroughFirewall` before any bridge is asked; `dm` and the social actions plan onto `shellRelayOrigins(tiers)`; and the uploader plans the first file server ([D-056](../decisions.md#d-056)). `options.theme` is used only when `isTheme` accepts it. `resolveIdentity` maps the source window kehto passes to the resource resolver to its verified identity, so kernl names the requesting applet to the bridges. The `relay` service is `createAppletRelayService`, which plans each publish onto the tier for its kind; kehto publishes only to the plan. `identity` reads a signer that stays the same object while the account does, because kehto drops a reply when the signer changed under it ([D-037](../decisions.md#d-037)). `cvm` is `createRemoteToolsService`: each window calls remote tools under its own key from `createWindowIdentities`, looking on `options.remoteTools.relays` or else the `super` tier, see [Remote tools](#remote-tools). Where the page has `RTCPeerConnection`, or `options.directConnections.createPeer` is given, `webrtc` is `createDirectConnectionsService`, see [Direct connections](#direct-connections).
6. **ShellAdapter.** `createShellAdapter` builds kehto's adapter from the relay-pool hooks, the relay-config hooks over the tiers, `createAuthHooks(accounts, consent)`, the service registry, `capabilities.resolveEnvironment` from `createEnvironmentResolver(grants)`, `onNappletRevoked` (removes the frame through the handle, on every reason including `deferred-overflow`), `filterNappletMessage` (answers kehto with `pipeline.observe`: `dispatch`, `defer` or `drop`), `getFocusContext` (`{ focused }` from the pipeline's visibility), `permissions` from `createFirewallPermissions` (the firewall's host side: the user's rules from `createFirewallRules` as `defaultDecision`, questions through `host.presentApproval`, stored answers at `kernl:firewall-decisions:v1`, `createRuntimeRateLimiter` as `rateLimiter`, and `onRateLimit` feeding the guard log without anything the applet sent), and `aclDefaultPolicy: 'restrictive'`, which under `permissions` is a ceiling no firewall answer exceeds ([D-020](../decisions.md#d-020), [D-056](../decisions.md#d-056)). The retired `kernl:firewall:v1` key is removed from the host storage first. Choices kehto left open are fixed here: applets cannot create windows (`createWindow` returns null), a key an applet forwards goes to `host.onShortcut` when the host has it ([D-054](../decisions.md#d-054)), there is no worker relay, update behaviour is `banner`, signatures are verified by applesauce's `verifyEvent`, `link.isAvailable` is true and `getNip66Suggestions` is null.
7. **Bridge.** `createShellBridge(adapter)`, unchanged ([D-001](../decisions.md#d-001)). `createFirewall({ rules, permissions: bridge.runtime.permissions })` over it is `kernl.firewall`, see [The firewall](#the-firewall).
8. **Grants.** `createGrants({ acl: bridge.runtime.aclState, storage: host.storage, availableDomains: () => buildShellCapabilities(adapter).domains })`. The ACL is restrictive, so an applet holds only what the grants layer writes, see [Grants](#grants). Nothing follows `pipeline.profile$` for the runtime: its rate limiter reads the guard configuration on every charge.
9. **Consent.** Before steps 5 and 6, `lookupReplaceable(eventStore, { loader: createReplaceableLoader(eventStore, pool, tiers), relays: () => [...outbox, ...discovery] })` builds the before lookup and `createSigningConsent({ host, lookupBefore, resolveApplet: identityOf, pubkey })` builds the gate, and both of the routes an applet's write can take pass through it: `relay.publish` is signed through `ShellAdapter.auth.getSigner(windowId)`, whose `signEvent` calls the gate first, and `outbox.publish` is gated in the outbox service wrapper before kehto signs it. For a kind `isDestructiveKind` accepts (every replaceable and addressable kind, 5 and 62), the gate describes the draft against the current version, from the event store or else from the outbox and discovery relays within `CURRENT_VERSION_TIMEOUT_MS`, calls `host.presentConsent` and waits; anything but yes rejects with `denied:consent` and nothing is signed. Routine kinds are not prompted; the shell's own signing (no window) is not gated; answers are not remembered. kehto's runtime has no destructive-signing consent of its own. Separately, `bridge.registerConsentHandler(createConsentHandler(host, lookupBefore, identityOf))` answers kehto's own `ConsentRequest`, which only the runtime's former rate gate raised, without an event; kernl no longer runs that gate, and the handler refuses a request without an event.
10. **Session.** `accounts.active$` drives `session$` (`toSession(account)` or null) and calls `bridge.publishIdentityChanged(pubkey)` with the active pubkey or `''` on sign-out, so bound applets hear every identity change through kehto's live port.
11. **Lifecycle.** `createAppletLifecycle` with `createAppletAdmissions(bridge.runtime, now)`, which puts every start to the firewall, `options.artifactCache ?? openDefaultArtifactCache` and `host.fetchBlob ?? defaultFetchBlob`.
12. **Events.** `connectEventCache(eventStore, options.eventCache)` opens the event cache in the background; the replaceable loader, the profiles and the catalogue ask it first (D-030). `kernl.mailboxes` follows the active account's kind 10002 and sets the `outbox` tier from it; `kernl.directory` waits for `start()` (D-029).
13. **Download programs.** After the registries, `options.secrets ?? createStorageSecrets(host.storage)` is the secrets provider and `createKernlDownloads` builds `kernl.downloads` over it. When the installed `@kehto/shell` prelude renders a binding table (`supportsDomainBindings()`), or `options.downloads.offer` says the host's own does, the `torrent`, `nzb` and `soulseek` handlers are added to the service registry in step 5, the three domains are added to what step 8's `availableDomains` reports, and the lifecycle of step 11 is handed `DOWNLOAD_BINDINGS`; otherwise only the settings exist. An NZB an applet names by address is fetched with `bridges.resolve(url, { requester: 'shell' })`, so it meets the HTTP bridge's policy ([Connected programs](#download-programs-and-secrets), [D-050](../decisions.md#d-050), [D-052](../decisions.md#d-052)).

`destroy()` closes every open applet, unsubscribes the session subscription, disposes the dm service and the download services, destroys the bridge and closes the pool if the shell owns it.

### The `KernlHost` contract

The host is the only way the core reaches the user or the page. Applets never reach these hooks.

| Member | Called when |
| --- | --- |
| `storage: StorageLike` | Every persisted value: accounts (`kernl:accounts:v1`, `kernl:active-account:v1`), relay tiers (`kernl:relays:v1`), grants (`kernl:grants:v1`), firewall rules and kept answers (`kernl:firewall-rules:v1`, `kernl:firewall-decisions:v1`), messaging preferences (`kernl:messaging:v1`), installed applets (`kernl:installed:v1`), handler choices (`kernl:intent-defaults:v1`, `kernl:intent-sync:v1`) applet settings (`kernl:applet-config:v1`) and the download programs with what applets started in them (`kernl:download-programs:v1`, `kernl:torrent-jobs:v1`, `kernl:nzb-handles:v1`, `kernl:nzb-replay:v1`; with the default secrets provider, `kernl:secrets:v1:<name>` too). `localStorage` satisfies it; tests use a `Map`. |
| `presentConsent(prompt)` | An applet window asked the shell to sign, through `relay.publish` or `outbox.publish`, an event whose kind is destructive. `prompt.summary` is a `ConsentSummary` whose `event` is the unsigned draft (empty `id` and `sig`); `prompt.resolve(true)` signs, `prompt.resolve(false)` (also on dismiss) makes the signer throw `denied:consent`. The core never times a prompt out. The same hook carries the questions of an upload, a direct connection and a download service; those summaries have no `event`. |
| `notify(notice)` | An applet calls `notify.send`, or the guard has something to say. `notice.tone` is `info` or `warning`; `windowId` names the applet when there is one. |
| `openLink(url, options?)` | An applet's `link.open` passed the link policy (`LINK_PROTOCOLS`: `https:` and `mailto:` only) and the firewall, or a bridge hands a locator to an app on the device. `options.approved` is `true` when the firewall already let this exact link through, by asking the user or by a rule they set, so the host should open it without asking again; without it, the host asks before leaving. |
| `getVisibility(windowId)` | Current visibility for a window, when the core needs it synchronously: the guard asks the first time it meets a window that `handle.setVisibility` has not reported on yet, and keeps that answer until the next `setVisibility`. |
| `onRevoked(windowId, reason)` | The core removed a frame because the bridge revoked its binding, the guard quarantined it (`quarantine`), a grant it was started with was taken back (`grant-narrowed`, `blocked`), or a firewall answer or rule it ran under was taken back or tightened (`firewall`). |
| `presentSettings?(prompt)` | Optional. An applet holding the `config` grant asked to open its settings (`config.openSettings`) after registering a schema. `prompt` is a `SettingsPrompt`: `{ title, section?, context }`, where `context` is kehto's `ConfigSettingsContext` with the accepted `schema`, the current `values` and `commit(values)`, which validates, saves and sends the values to the applet, and throws when they do not conform. Draw a form from the schema, mask `x-napplet-secret` fields, group by `x-napplet-section`, and open at `section` when given. Nothing is resolved; closing the form commits nothing. Without it the `config` domain is not offered (D-036). |
| `chooseHandler?(prompt)` | Optional. An applet asked for a role and an action and the shell needs the user to pick who does it. `prompt` is a `HandlerPrompt`: `{ archetype, action, convention, source, options, recommended? }`, with `options` the installed applets that can, preferred first, and empty when none can. Resolve a `HandlerChoice` `{ id, remember }`, possibly for an applet installed while the chooser was open with `kernl.install`, or `undefined` on dismiss. Without it, a request with several handlers and no default is refused. |
| `openApplet?(address)` | Optional. Open the applet at an address under its existing grants and resolve its window id, or `undefined` when it did not open. Called to start an intent's handler. |
| `focusApplet?(windowId)` | Optional. Bring a running handler's window to the front. |
| `chooseReply?(prompt)` | Optional. A one-to-one message is about to leave through a provider other than the one its recipient last wrote through, and the reply rule is `ask`. `prompt` is a `ReplyPrompt` from `@kernlize/messaging`: `{ peer, theirs, mine }`. Resolve a `ReplyAnswer` `{ use: 'theirs' \| 'mine', remember: 'once' \| 'conversation' \| 'always' }`, or `undefined` on dismiss, which stops the send with `denied:cancelled`. Without it the provider the user's order picked is used. See [Messaging](../concepts/messaging.md#which-provider-carries-a-message). |
| `presentApproval?(prompt)` | Optional. A firewall rule says to ask about a request, such as opening a link. `prompt` is a `FirewallPrompt`: `{ summary, signal, resolve }`. `summary` is a `FirewallSummary` `{ kind: 'link' \| 'access' \| 'request', applet, requests, choices }` and carries no copy; the host words it. Call `prompt.resolve(choice)` with one of `summary.choices` (`allow-once`, `allow-session`, `allow-always`, `deny`), or `resolve(undefined)` on dismiss, which stores nothing. Close the prompt when `prompt.signal` aborts: the applet closed, or the question waited `FIREWALL_PROMPT_TIMEOUT_MS`. Without it, a request a rule says to ask about is refused ([D-056](../decisions.md#d-056)). |
| `fetchBlob?(sha256, servers)` | Optional. Replaces `defaultFetchBlob` for artifact bytes; the bytes are hashed by kehto either way. |
| `onShortcut?(key)` | Optional. A key was pressed inside an applet that holds no binding for it (`keys.forward`). `key` is a `ShortcutKey`: `{ key, code, ctrlKey, altKey, shiftKey, metaKey }`, as a `KeyboardEvent` names them. Run your own shortcut for it, or ignore it. Without the member the shell's own shortcuts do nothing while an applet has focus ([D-054](../decisions.md#d-054)). |
| `now?()` | Optional clock for the guard. |

### The `Kernl` surface

| Member | What it is |
| --- | --- |
| `accounts`, `eventStore`, `pool`, `bridge` | The applesauce `AccountManager`, `EventStore` and `RelayPool`, and kehto's `ShellBridge`. The web shell hides all but `accounts` from its UI. |
| `guard: GuardFacade` | `config`, `profile$`, `setProfile(profile)`, `events$`, `mitigations()`, `release(windowId)`. `setProfile` rebuilds kernl's guard layers shell-wide; held window-level messages are dropped and counters restart. The runtime's rate limiter reads the new budgets on its next charge, and its counters carry over. It is not persisted. |
| `grants: Grants` | The user-facing grants surface, see [Grants](#grants). |
| `firewall: Firewall` | The rules for what applets may do without the user being asked, and the answers in force, see [The firewall](#the-firewall). |
| `relays: RelayTiers` | `get()`, `add(tier, url)`, `remove(tier, url)`, `set(tier, urls)`, `changes$`. `add` and `set` throw `invalid:relay-url` for anything that is not `ws://` or `wss://`; `set` with an unchanged list emits nothing. |
| `files: AccountFileServers` | Where the account's uploads go; the `upload` domain is offered and every upload is asked about (D-033). |
| `multiplayer: KernlMultiplayer` | The person's servers, connection helpers and trusted tool families for direct connections and remote tools, kept on this device and coming before the host's; `discover(input)` finds families to trust ([Your own settings](#your-own-settings), D-043). |
| `downloads: DownloadClients` | The person's connections to the programs they run, on this device: `state$`, `state()`, `ready`, `check(program, typed, existing?)`, `add(program, signIn, label?)`, `update(id, change)`, `remove(id)`, `chooseDefault(domain, id)` and `routing(domain)`, which the services read ([Download programs and secrets](#download-programs-and-secrets), D-050, D-053). |
| `secrets: SecretsDescription` | `{ label, keeps }`: how the secrets provider in use keeps a password or key, so a settings screen can say so. The provider itself is not exposed (D-052). |
| `mailboxes: AccountMailboxes` | The signed-in account's published inbox and outbox (kind 10002, D-029). While a list is `found`, the `outbox` tier follows its outboxes, so every publish goes where the account says it writes. `save` signs with the active account and refuses `denied:read-only` for a read-only or signed-out session. |
| `directory: RelayDirectory` | Monitored servers (kind 30166) from `DEFAULT_MONITOR_RELAYS`, idle until `start()`; `search` completes an address and `suggest` proposes servers. The shell's Settings starts it when its Servers section is opened, and stops it when the window closes. |
| `messaging`, `bridges` | The registries the services read. |
| `catalog: AppletCatalog` | `stream(options?)` emits the store's entries from the `apps` and `super` tiers as they arrive; `load(options?)` resolves with the final list, see [The store and intents](../concepts/store-and-intents.md). |
| `profiles: Profiles` | `card$(pubkey)` and `card(pubkey)`: how the shell names a person. The session label follows the account's published name. |
| `intents: Intents` | `installed$`, `installed()`, `uninstall(catalogId)` and `defaults` (a `HandlerDefaults`: `get`, `all`, `set(archetype, id \| undefined)`, `synced`, `load`, `sync`, `setSync`, `changes$`). |
| `install(summary)` | Install a verified applet without opening it; throws `invalid:unresolved` for a summary this shell did not verify. |
| `session$`, `session` | `Session \| null`: `{ accountId, pubkey, label, readOnly }`. The label is the account's `metadata.name`, then `account.name`, then the abbreviated pubkey. |
| `login(account)` | Adds the account to the manager if it is not there, makes it active, returns its `Session`. `KernlAccountManager` refuses plaintext-key account types here. |
| `logout()` | Clears the active account. |
| `decodePointer(input)` | See [resolve → plan → mount](#resolve-→-plan-→-mount). |
| `resolve`, `plan`, `mount`, `applets()`, `handleWindowMessage(event)` | The applet lifecycle. `plan` also installs the applet. |
| `destroy()` | Tears the shell down. |

### resolve → plan → mount

`decodePointer(input)` accepts `naddr1…`, `nevent1…`, `note1…`, a bare 64-hex event id, any of those behind a `nostr:` prefix, and plain coordinates in `<pubkey>:<kind>:<identifier>` or NIP-01 `<kind>:<pubkey>:<identifier>` order. An encoded address is also found inside a link or a sentence (`https://applets.example/n/naddr1…?ref=share`), because that is how addresses get shared. Anything else throws `invalid:pointer`. The pointer says which event to fetch and nothing more.

`kernl:<id>` is the one address that fetches nothing: it decodes to `{ kind: 'builtin', id }` and names an applet the host ships in `KernlOptions.builtins` ([D-027](../decisions.md#d-027)). `resolve` loads it with the `BuiltinApplet`'s own `load()`, hashes the text with SHA-256 and refuses it with `invalid:artifact-hash` unless it matches the `sha256` the host pinned; a name the host does not ship is `invalid:pointer`, and a `load()` that rejects is `unavailable:blob`. The summary is shaped like a published applet's (`builtin: true`, `address: 'kernl:<id>'`, publisher `BUILTIN_PUBLISHER`, a manifest with the declared `requires`, `optional` and `archetypes`), so `plan`, `mount`, grants and intents treat it the same, and it is sealed in the same frame. The first time the user meets it, the domains in its `grants` that this shell offers are switched on; after that the grant record is the user's and is never touched again.

`resolve(pointer)` fetches the manifest in at most two rounds (newest event wins for addresses). The first asks the pointer's relay hints plus the `apps` tier; when that does not produce the manifest, because those relays do not hold it or because none answered, the second asks the `super` tier. Hints that are not relay URLs are dropped, and a relay that is down, silent or hangs up does not fail a round while another answers. Each round runs on three clocks, `MANIFEST_TIMING`: once a manifest is in, the other relays have `settleMs` (3 s) to offer a newer one; once a relay has answered with nothing, the others have `patienceMs` (8 s) to do better, so a slow catalogue is not cut off by a quick relay that holds nothing; and the round ends after `timeoutMs` (10 s) when nothing answers. A relay that refuses the connection outright, as a busy public relay does for a moment with a 502 or 503, is dialled once more after `retryDelayMs` (1 s) by applesauce-relay. It throws `unavailable:manifest` when a relay answered and none had it, `unavailable:unreachable` when no relay in either round opened a connection, and `unavailable:network` when no relay answered in time ([D-039](../decisions.md#d-039)). It then verifies the manifest and artifact through kehto's `resolveNapplet`, with `host.fetchBlob` or `defaultFetchBlob` for the bytes and the artifact cache when the page has Cache Storage. Failures are rethrown as `unavailable:blob` or `invalid:<kehto code>` (`invalid:blob-hash-mismatch`, `invalid:invalid-signature`, …). The verified `index.html` is kept inside the lifecycle, keyed by identity; the caller gets an `AppletSummary` whose `requires` and `optional` are advisory.

`plan(summary)` throws `invalid:unresolved` for a summary this shell did not resolve. It calls `grants.ensure(identity)` so the ACL holds the applet's record, numbers the window `applet-1`, `applet-2`, …, has the firewall admit the start for the domains the grants leave (`denied:firewall` when a required domain is refused, `unavailable:firewall` when the firewall cannot decide; with the shipped rules the user is asked nothing), and returns a `MountPlan`: the environment from kehto's `resolveShellEnvironment` narrowed by the grants and then to the domains the firewall admitted, the `srcdoc` with the guard's zero-network CSP and the namespace prelude inserted by `prepareNappletSrcdoc` with kehto's `experimental.nestedContextLock` on (which adds the Trusted Types directives to that CSP), then kernl's insertion lock inserted right after the prelude ([D-014](../decisions.md#d-014)), `sandbox: 'allow-scripts'`, and `missingRequired`, the required domains the environment does not include. The host decides what to do with `missingRequired`; the core mounts whatever it is given.

`mount(plan, frame)` runs in this order:

1. Check that the firewall's admission for the plan still stands; otherwise throw `denied:admission-expired`.
2. Harden the frame: the `sandbox` attribute is set to exactly `allow-scripts`, replacing any tokens the host set; `denyNappletControllerAccess` when the frame has `getAttribute`, otherwise `allow` is set to `CONTROLLER_DENY_POLICY`.
3. `originRegistry.register(window, windowId, { dTag, aggregateHash, permissionPrincipal })`. The principal is `permissionPrincipalFor(plan.summary)`: the catalogue id and artifact hash from the verified manifest.
4. `originRegistry.setEnvironment(window, plan.environment)`.
5. `bridge.observeFrame(frame, windowId)`, so a second load revokes the binding.
6. Assign `frame.srcdoc = plan.srcdoc`. The handle's status moves from `mounting` to `running` on the frame's first `load`.

A frame without a `contentWindow` throws `invalid:frame-detached`. `handle.close()` calls `bridge.revokeNapplet(windowId, 'host')`, unregisters the window, removes the frame and forgets the window in the guard; a revocation from the bridge (`window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed`, `deferred-overflow`, `host`) removes the frame, forgets the guard state and calls `host.onRevoked`. A firewall answer taken back does the same with reason `firewall`. The frame is never reused. `handle.setVisibility(visibility)` feeds the guard's visibility gate; when the window becomes visible, the requests kehto held for it are released.

`handleWindowMessage(event)` resolves the sending window from `originRegistry`, never from the message, and runs the guard pipeline in front of `bridge.handleMessage`. Messages from windows the shell does not know are forwarded unguarded so kehto can report them as unrouted.

### Messaging backends

`createKernl` registers all four providers through `createDefaultMessaging` and, unless `KernlOptions.messagingBackends` overrides them, wires four network backends built on the active account's signer ([D-015](../decisions.md#d-015), [D-016](../decisions.md#d-016)). `KernlOptions.messagingBackends` is a `MessagingBackendFactories`: `{ private?: () => MessagingBackend; legacy?: () => MessagingBackend; ratchet?: () => MessagingBackend; group?: () => MessagingBackend }`; a factory there replaces kernl's backend for that provider.

`createPrivateMessagesBackend({ store, pool, tiers, signer, selfPubkey, now? })` is a `MessagingBackend` over NIP-17. `signer` and `selfPubkey` are functions, read on every call, so one backend follows sign-in and sign-out.

- **Send.** The message is a kind 14 rumour. It is sealed in a kind 13 event signed by `signer()`, encrypted with its `nip44`, and wrapped in a kind 1059 event signed by an ephemeral key generated inside an applesauce `PrivateKeySigner` and discarded after that wrap; the key is never persisted. Each recipient's wrap is published to their kind 10050 inbox relays, or to the user's `outbox` and `super` tiers when they publish none, and one more wrap is addressed to the user.
- **Receive.** `subscribe` asks for kind 1059 events with `#p` set to `selfPubkey()` on the user's own kind 10050 inbox relays, or the same tiers. Wraps are opened with applesauce's helpers and the account signer and filed in an in-memory conversation store that belongs to the active account; it is cleared when the account changes or signs out. The event `store` is where inbox relay lists are read from.
- **Conversations.** A conversation id is the sorted participant set, so the same people always meet in the same conversation, whoever wrote first.

`createLegacyMessagesBackend(...)` takes the same options and sends NIP-04 kind 4 events through `signer().nip04`, with the same normalisation into `DmConversation` and `DmMessage`. It is the metadata-exposing provider: sender, recipient and timing are public on the event.

`createRatchetMessagesBackend({ pool, tiers, storage, signer, selfPubkey, accountChanges?, discoveryTimeouts? })` is a `MessagingBackend` over the `nostr-double-ratchet` library ([D-016](../decisions.md#d-016)).

- **Runtime.** One `NdrRuntime` per signed-in account, built on first use and closed when the account changes or signs out. The account signer signs the owner's device list (the library's unsigned owner events are re-signed from their template); the library generates and holds this browser's device key and the per-session ratchet keys. `discoveryTimeouts: { fetchMs, fastMs }` shortens how long it waits for relays to return the device list (library defaults 10 s and 2 s).
- **Storage.** `createSealedRatchetStorage({ storage, signer, owner })` is the library's `StorageAdapter`. Each value is JSON, split into chunks that fit `nip44`, encrypted to `owner` with `signer.nip44`, and kept at `kernl:ratchet:v1:<owner>:<slot>`; the map from the library's key names to slots is one more sealed entry at `…:index`. Values are decrypted once per page load and writes are applied in order.
- **Send and receive.** A send names exactly one other person (`invalid:groups-unsupported`, `invalid:no-recipients`, `invalid:unknown-conversation`); the library queues it until a session exists. Received rumours of kind 14 are filed with the same conversation ids as the other backends; typing notices, receipts and controls are dropped. Setup that cannot reach a relay fails with `unavailable:offline` and is retried on the next call.
- **Relays.** Reads and writes use the user's `outbox` and `super` tiers, so both sides must share one.

None of the backends holds key bytes outside a signer or a sealed store; signing, encryption and decryption all go through the account's applesauce signer. The shell draws no conversation itself: messages are shown by an applet over the `dm` domain grant, and the one kernl ships starts with that grant because it came with the shell ([D-027](../decisions.md#d-027)). `createDefaultMessaging` takes the reply question as `askReply`, which `createKernl` wires to `KernlHost.chooseReply`, and switches `private` and `legacy` on for someone who has never chosen; each starts once an account that can run it signs in.

Availability follows the active account. An unavailable provider reports a reason from `MESSAGING_UNAVAILABLE_REASONS`, and `enable(id)` throws it as `unavailable:<reason>`:

| Provider | Available when | Reason otherwise |
| --- | --- | --- |
| `private` | The active signer exposes `nip44` | `sign-in-required` with no active account, `signer-cannot-encrypt` without `nip44` |
| `legacy` | The active signer exposes `nip04` | `sign-in-required` with no active account, `signer-cannot-encrypt` without `nip04` |
| `ratchet` | The active signer exposes `nip44` | `sign-in-required` with no active account, `signer-cannot-encrypt` without `nip44`; `no-runtime` only when a host registers it without a backend |
| `group` | The active signer exposes `nip44` | `sign-in-required` with no active account, `signer-cannot-encrypt` without `nip44`; `no-runtime` only when a host registers it without a backend |

### Group sessions

`createGroupMessagesBackend({ store, pool, tiers, storage, signer, selfPubkey, now?, accountChanges? })` is a `MessagingBackend` over `@internet-privacy/marmot-ts` ([D-018](../decisions.md#d-018)), the maintained TypeScript implementation of the Marmot protocol (MLS over nostr).

- **Client.** One `MarmotClient` per signed-in account, started on first use and dropped when the account changes or signs out. The account signer signs identity proofs and key packages and opens invitations; the library holds its MLS keys and group secrets.
- **Storage.** `createSealedGroupStore({ storage, signer, owner }, name)` is the library's `GenericKeyValueStore`. Each store is one JSON value (bytes and big integers tagged), split into parts NIP-44 can carry and encrypted to the account with its `nip44`, under `kernl:group:v1:<owner>:<name>`. It is decrypted once per page load and served from memory; writes are applied in order.
- **Network.** `createGroupNetwork(pool, inboxRelays)` adapts the shell's one relay pool to the library's `NostrNetworkInterface`. A publish no relay accepted answers with no acknowledgements, and a failed request with no events.
- **Sending.** A send to people goes to the group with exactly those members, else founds one inviting each by their newest kind 30443 key package; `unavailable:recipient-not-ready` when someone has none. A send into a conversation needs a group this device belongs to (`invalid:unknown-conversation`), and a message no relay accepted is taken back with `unavailable:offline`.
- **Types.** `GroupMessagingOptions` is `SignerMessagingOptions` plus `storage`; `SealedGroupStoreOptions` is `{ storage, signer, owner }`; `InboxRelays` is `(pubkey) => Promise<string[]>`, the resolver the private and group backends share.
- **Ids.** The conversation id is the group id in hex; through the composite it is `group:<hex>`. Message ids are the kind 9 rumour id; other rumour kinds a group carries are not messages and are skipped.

Preferences persist at `kernl:messaging:v1`.

```ts
import { createKernl, createLegacyMessagesBackend, createPrivateMessagesBackend, type KernlHost } from '@kernlize/core';

declare const host: KernlHost;

const kernl = createKernl({ host });
const account = () => kernl.accounts.active;
const deps = {
  store: kernl.eventStore,
  pool: kernl.pool,
  tiers: kernl.relays,
  signer: () => account()?.signer,
  selfPubkey: () => account()?.pubkey,
};

const privateMessages = createPrivateMessagesBackend(deps);
const legacyMessages = createLegacyMessagesBackend(deps);

await privateMessages.send({ recipients: ['<hex pubkey>'], content: 'hello' });
legacyMessages.subscribe({}, (message) => console.log(message.content));
```

### Accounts

`createKernlAccounts(storage)` returns a `KernlAccountManager` with applesauce's common account types registered, state restored from `kernl:accounts:v1` and `kernl:active-account:v1`, and every later change persisted. `KernlAccountManager.addAccount` throws `denied:plaintext-key-persistence` for the types in `PLAINTEXT_KEY_ACCOUNT_TYPES`, `['nsec', 'seed-words']`: `PrivateKeyAccount` serialises the key itself and `SeedWordsAccount` the mnemonic. Any such entry found in storage is dropped on restore. The only persisted form of a local key is applesauce's `PasswordAccount`, whose `ncryptsec` is NIP-49 encrypted.

`createThrowawayIdentity()` makes an identity for trying the shell: a fresh key in memory that signs like any other. The manager accepts it and never stores it, because it refuses to serialise; a reload starts without it ([D-044](../decisions.md#d-044)).

`createAuthHooks(accounts, consent)` is kehto's `AuthHooks`: `getUserPubkey` is the active pubkey or null; `getSigner(windowId?)` is null while nobody is signed in and for read-only accounts, so the runtime refuses writes instead of failing inside a signer. The `identity` service is the one exception to "no signer, no answer": for a read-only account `createKernlServices` hands it a view that answers `getPublicKey` and nothing else (from `KernlServiceDeps.auth.getUserPubkey`), so an applet the user granted `identity` learns which account is signed in, and every write still finds no `signEvent`. With a `windowId`, the returned signer's `signEvent` awaits `consent(windowId, template)` before the account signs; without one it is the account's signer, ungated. `wrapAccountSigner(account)` exposes `getPublicKey`, `signEvent` and the `nip04`/`nip44` namespaces the account has, never the account.

### Relay tiers

`DEFAULT_RELAY_TIERS`, used when nothing is persisted and `options.relays` says nothing for a tier:

| Tier | Default | Serves |
| --- | --- | --- |
| `discovery` | `wss://purplepag.es`, `wss://relay.nos.social` | kinds 0, 3 and 10002, together with `outbox` and `super` |
| `apps` | `wss://relay.napplet.soy`, `wss://relay.ditto.pub`, `wss://relay.nostr.com` | applet manifests (the NIP-5D kinds and 32267) |
| `outbox` | none | the user's own relays, merged with `super` for everything else |
| `super` | `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.primal.net` | everything else |

`selectRelayTier(tiers, filters)` routes a filter set to `discovery`, `outbox` and `super` (deduplicated) when every kind is a discovery kind, because profiles, follows and relay lists live on indexers and on their authors' own servers (NIP-65), to `apps` when every kind is an applet kind, and to `super` plus `outbox` (deduplicated) otherwise, including filters without kinds. kehto's `RelayConfigHooks` sees `discovery`, `super` and `outbox`; `apps` is kernl's addition.

### Grants

`BASELINE_DOMAINS` is `['shell', 'inc', 'theme', 'storage', 'keys']`: every applet gets the handshake, in-shell messaging, the theme, its own scoped storage, which it can read and write, and keyboard shortcuts, which act only in its own focused window ([D-054](../decisions.md#d-054)), and no network. `identity` is not in the baseline: an applet learns which account is signed in only after the user grants it ("your account" in the shell). `DOMAIN_CAPABILITIES` maps each NAP domain to the kehto capabilities it needs:

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
| `webrtc` | none: kehto's ACL has no capability for it, so the `webrtc` service checks the grant itself ([D-042](../decisions.md#d-042)) |
| `torrent`, `nzb`, `soulseek` | none: they are not kehto domains. The runtime admits each by the environment the window was mounted with and the service's own message list ([D-050](../decisions.md#d-050)) |

Unknown domains need no capability (`capabilitiesForDomain('made-up')` is `[]`). `createGrants` keeps a per-identity record `{ dTag, hash, domains, blocked }` at `kernl:grants:v1` and, on every commit, writes it into kehto's ACL, which is restrictive (`aclDefaultPolicy`, [D-020](../decisions.md#d-020)): every capability a baseline or allowed domain needs is granted, whatever the applet's stored entry holds beyond that is revoked, then `block`/`unblock` is applied and the ACL persisted. `KernlGrants.ensure(identity)` does this for an applet that has no record yet; `plan` calls it. `createEnvironmentResolver(grants)` is the `capabilities.resolveEnvironment` hook: each applet sees the baseline plus its allowed domains, intersected with what the shell offers; a blocked applet sees only `shell`. The calls are in [Grant and revoke](../how-tos/grant-and-revoke.md).

### The firewall

`kernl.firewall` is the host's view of kehto's firewall ([D-056](../decisions.md#d-056)). Grants decide which domains an applet holds; the firewall decides, inside those, what goes ahead without asking, what asks the user, and what is refused. The concept is in [Guard](../concepts/guard.md#the-firewall).

| Member | What it does |
| --- | --- |
| `rules()`, `rules$` | The rules in force, kehto's `PermissionRules`. A shell starts with `defaultFirewallRules()`: everything allowed, `link.open` asking. |
| `setRule(target, action)` | Set `allow`, `ask` or `deny` for a `FirewallRuleTarget` `{ applet?, domain?, operation? }`, or remove the rule with `undefined` so the next wider one applies. `{}` is the rule for everything; `applet` is a catalogue id, as in `summary.manifest.catalogId`. Throws `invalid:rule` for a target kehto refuses. An applet running under an answer the new rules no longer give is stopped. |
| `restoreDefaults()` | Back to the shipped rules, with the same effect on running applets. |
| `decisions()`, `decisions$` | The answers in force, as `FirewallDecision`s `{ id, catalogId, hash, request, effect, lifetime: 'session' \| 'always', byRule }`. `byRule` is true for an answer a rule gave for a running applet, false for one the user gave. An answer for one opening is used up at once and never listed. |
| `forget(id)` | Take one answer back; an applet running under it is stopped. `false` when the stored copy could not be removed. |
| `available` | `false` when the stored answers could not be read; every applet is refused until `forgetAll()`. |
| `forgetAll()` | Take every answer back and stop every applet. `false` when the stored copy could not be removed. |

```ts
import type { Kernl } from '@kernlize/core';

declare const kernl: Kernl;

kernl.firewall.setRule({ operation: 'link.open' }, 'allow'); // links open without asking
kernl.firewall.setRule({ domain: 'relay' }, 'ask'); // ask before an applet starts with relay
kernl.firewall.setRule({ operation: 'link.open' }, undefined); // remove the rule; the wider one applies

const mine = kernl.firewall.decisions().filter((decision) => !decision.byRule);
for (const decision of mine) kernl.firewall.forget(decision.id);
```

A stopped window is removed with reason `firewall` and reported through `host.onRevoked`. Rules are kept at `kernl:firewall-rules:v1` and follow an applet across versions; answers the user asked to keep are at `kernl:firewall-decisions:v1` and are tied to the exact code.

### Consent summaries

`describeChange(event, before, applet)` turns a write into a `ConsentSummary` with a `title`, a `severity` and `lines` of `{ label, before?, after? }`:

| Kind | Severity | Title | Lines |
| --- | --- | --- | --- |
| `0` | `destructive` | Update your profile | One line per changed field among name, display name, about, picture, banner, verified address, payment address and website; or "No profile fields change". |
| `3` | `destructive` | Change who you follow | "Follows added" and "Follows removed" with counts and the first three pubkeys abbreviated; or "No entries change". |
| `5` | `destructive` | Delete N item(s), or Delete N post(s) when the `k` tags say every target is kind 1 and no `a` tag is present | One "Delete" line per `e` tag, abbreviated, and one "Delete every version of" line per `a` tag, naming the address in plain words, for example `record (type 30001) "books" by person 3bf0c63f…`. |
| `62` | `destructive` | Ask relays to erase your identity | "Erase: Everything this identity has published" and "Relays asked": every relay when the `relay` tags are absent or include `ALL_RELAYS`, else the first three named. |
| `10002` | `destructive` | Change your inbox and outbox | "What this is", then "Inbox relays added/removed" and "Outbox relays added/removed", each relay by its own host; an unmarked relay is in both (NIP-65). |
| 10000–10099, 30000–30099 | `destructive` | Change the list "title or d tag", or "Change a list" | "Entries added" and "Entries removed", each entry in plain words: `person 3bf0c63f…`, `item 3bf0c63f…`, `topic …`, `type N`, `relay example.com`, `key 3bf0c63f…`, or `name value` for any other tag. |
| any other replaceable (10100–19999) or addressable (30100–39999) kind | `destructive` | Replace one of your records (type N), with the `title` or `d` tag in quotes when there is one | "Entries added" and "Entries removed" over the tags other than `d`, `title` and `description`, and "Content: Replaced" when the content differs, without copying it. |
| anything else | `routine` | Publish a post, repost, reaction, comment, article, sealed message, legacy private message, payment receipt, or "record (type N)" | One "Content" line with a 140-character preview. |

`isDestructiveKind(kind)` is true for exactly the `destructive` rows: every replaceable kind (0, 3, 10000–19999), every addressable kind (30000–39999), 5 and 62.

`LookupBefore` is `(kind, pubkey, identifier?) => Promise<NostrEvent | undefined>`. `lookupReplaceable(store, options?)` builds one: the store answers first; on a miss, and only when `options.loader` is given, the applesauce address loader asks `options.relays()` and the lookup waits at most `options.timeoutMs` (default `CURRENT_VERSION_TIMEOUT_MS`, 4000 ms) and takes the newest version that arrived. A loader that fails or stays silent yields `undefined`. When a replaceable or addressable write is described and no current version was found, the summary's first line is `UNKNOWN_CURRENT_VERSION`, "Current version: could not be loaded; this replaces it entirely", so it never reads as a first version that removes nothing.

Three summaries come from elsewhere: an upload is `public` (`describeUpload`, [D-033](../decisions.md#d-033)), a direct session is `direct` (`describeDirectConnection`, [D-042](../decisions.md#d-042)), and a download service's question (`describeDownloadQuestion`, [D-050](../decisions.md#d-050)) is `destructive` when it erases files, `direct` when what it starts shows peers a network address (`torrent`, `soulseek`) and `routine` otherwise (`nzb`). All are always asked about. None of them is about an event, so `ConsentSummary.event` is optional and absent on these.

`createSigningConsent(options)` returns the `SigningConsent` gate, `(windowId, template) => Promise<void>`: it resolves at once for a routine kind; for a destructive one it builds an unsigned draft (empty `id` and `sig`; this draft is the summary's `event`), describes it against `lookupBefore`, and resolves only when `host.presentConsent` answers yes. It rejects with `denied:consent` when the user refuses, `denied:unknown-applet` for a destructive write from a window the shell did not mount, `denied:signed-out` for a destructive write while nobody is signed in, and `invalid:event-kind` when the kind is not a number.

`createConsentHandler(host, lookupBefore, resolveApplet)` answers kehto's own `ConsentRequest`. Only the runtime's former rate gate raised one (`firewall-policy`, without an event), and kernl no longer runs that gate ([D-056](../decisions.md#d-056)); the handler refuses a request without an event. A request that does carry an event, from a window the shell can name, would be described and put to the user; one from an unknown window is refused. Firewall questions do not come this way: they reach the host through `presentApproval`.

### Remote tools

An applet with the `cvm` grant ("remote tools") calls tools on remote servers through `window.napplet.cvm`: it finds servers by their announcements, sends a tool request and gets the answer. `createRemoteToolsService` registers kehto's tool service once per window, each with its own `createNostrCvmTransport` over the shell's pool ([D-041](../decisions.md#d-041)):

- **A key per window, never the account's.** `createWindowIdentities` gives each window an applesauce `PrivateKeySigner` the first time it calls a tool. Requests are sealed to the server under that key, so the server cannot link two applets to each other or to the account, and the account signs nothing. The key is never stored; when the window closes or its grant changes, the transport closes and the key is overwritten with zeros.
- **No crosstalk.** A notice a server pushes to one window's key reaches only that window, because no two windows share a transport.
- **Where servers are looked for.** A server or search the applet names with relays is reached on those relays, as the `relay` domain honours an applet's hint. Otherwise the shell looks on `KernlOptions.remoteTools.relays`, or the `super` tier when the host names none. A request is published to every relay and succeeds when any accepts it (D-028).
- **Families.** `KernlOptions.remoteTools.registry` lists tool families the host vouches for, pinned to verified schema hashes, for applets that ask by family through `cvm.registry.*`. The default is none, so such a request finds nothing.
- **No payment.** kehto's transport does not pay servers, so an applet cannot spend anything through remote tools.

### Direct connections

An applet with the `webrtc` grant ("direct connections") opens a session with other people running it, through `window.napplet.webrtc`: it names a room (or a key it met in one), and the shell introduces the two sides through relays and connects their devices. `createDirectConnectionsService` registers kehto's WebRTC service once per window, over `createDirectSignaling` ([D-042](../decisions.md#d-042)):

- **Paja's `soy-rtc/1` signaling, under the window's own key.** Signals are kind 25050, signed by the window's key from `createWindowIdentities` (the same key its remote tools use), never the account's. Offers and answers are encrypted to the one peer they are for; presence repeats every two seconds. The room address mixes `directNamespace(summary)` (publisher, kind and name, as Paja derives it), the room or the two keys, the channel and the protocol, so different applets never meet; one applet meets the same rooms in Paja when both shells introduce people through the same servers, which by default they do not.
- **The grant, then the person, every session.** kehto opens a session only through the runtime's approval step. kernl supplies it: the window's applet must hold the `webrtc` grant and not be blocked, then `describeDirectConnection` puts the session to the person through `host.presentConsent`, marked `direct`. A no, a grant taken back while asking, or a closed window opens nothing and publishes nothing. kehto's ACL has no capability for `webrtc`, so the step checks the grant itself; an applet whose environment lacks `webrtc` is not routed to the service at all.
- **Relays and helpers are the host's.** `KernlOptions.directConnections.relays` introduce people, the `super` tier by default; `iceServers` are none by default, so only people who can reach each other's devices connect. With no relays, `planOpen` refuses with `signaling unavailable`.
- **Bounds.** Four sessions a window and eight peers a session; reliable ordered JSON of at most `DIRECT_MAX_PAYLOAD_BYTES` (16 KiB) a message. A session hears at most 32 signals a second and a peer at most 240 messages or 512 KiB a second; a peer that never connects is let go after 45 seconds. Refusals: `invalid room`, `invalid peers`, `invalid scope`, `invalid channel`, `invalid protocol`, `cannot connect to self`, `scope already open`, `session limit reached`, `peer unavailable`, `payload is not JSON of at most 16 KiB`, and kehto's `policy denied`.
- **Closing.** Closing a session tells the peers it left; when the window ends its sessions close, its peer connections close and its key is wiped.

### Your own settings

`kernl.multiplayer` is `createMultiplayerSettings(host.storage)` plus a search, kept at `kernl:multiplayer:v1` ([D-043](../decisions.md#d-043)). Each choice comes before the host's:

- `setServers(urls | undefined)`: the relays that introduce people and find tool servers, before `directConnections.relays` and `remoteTools.relays`, before the `super` tier. `invalid:relay-url` for anything but `ws:`/`wss:`.
- `setHelpers(helpers | undefined)`: STUN and TURN helpers, `{ urls, username?, credential? }`, before `directConnections.iceServers`. `invalid:helper`.
- `saveFamily(family)` and `removeFamily(label, pubkey)`: tool families the person trusts, at most 16; one with the same label and provider as the host's takes its place (`mergeFamilies`). `invalid:family` unless it has a label, a provider key and 1 to 64 uniquely named tools each pinned to a schema hash (`validFamily`).
- `discover(input)`, over the servers in use: `discoverToolFamilies` reads a reference to a server's or tool list's announcement (kinds 11316 and 11317), a tool's schema hash, or a website's `/.well-known/napplet.json` (at most 1 MB, no credentials), within `TOOL_DISCOVERY_TIMEOUT_MS` (15 s). Only signed announcements count, the newest inventory of each provider is used, and every tool's hash is computed again with kehto's `computeCvmToolSchemaHash`. It returns `ToolFamilyCandidate`s for the person to name; refusals are `invalid:tool-reference`, `unavailable:website`, `invalid:tool-inventory` and `unavailable:no-tools`.

Values are validated going in and coming out of storage; a stored value that fails is read as unset. The services read the settings each time a window starts using remote tools or direct connections.

### Download programs and secrets

`kernl.downloads` is `createDownloadClients` over `host.storage` and the secrets provider ([D-050](../decisions.md#d-050), [D-052](../decisions.md#d-052)). It keeps any number of connections, several to one program among them, each `{ id, program, label, url, username?, hasPassword, hasApiKey, routingKey }`, at `kernl:download-programs:v1`, and builds one `@kernlize/bridges` client per connection ([D-053](../decisions.md#d-053)). Secrets are kept under `download:<connection id>:password` and `download:<connection id>:apiKey`. `DOWNLOAD_PROGRAMS` lists the five programs:

| Program | Domain | Sign-in fields | Example address |
| --- | --- | --- | --- |
| `transmission` | `torrent` | `username`, `password` | `http://localhost:9091` |
| `utorrent` | `torrent` | `username`, `password` | `http://localhost:8080` |
| `nzbget` | `nzb` | `username`, `password` | `http://localhost:6789` |
| `sabnzbd` | `nzb` | `apiKey` | `http://localhost:8080` |
| `slskd` | `soulseek` | `apiKey`, `username`, `password` | `http://localhost:5030` |

- `check(program, typed, existing?)` waits for `ready`, works out the scheme when none was typed (`detectClientEndpoint`), and asks the program for its version. With `existing`, a connection's id, a password or key left empty is filled from that connection's kept one when the address is the one it was kept for; `invalid:connection` when the id is unknown or another program's. It resolves `{ signIn, notes, probe }` and saves nothing. It rejects with the address's `invalid:` reason, `invalid:sign-in` for a field that is not text of at most 512 characters, or the adapter's reason.
- `add(program, signIn, label?)` checks the address with `checkClientEndpoint` (it must carry a scheme), hands the password and key to the secrets provider under a new random id, and only then writes the record. The label is trimmed and 1 to 60 characters (`invalid:label`); without one it is the program's name, numbered from 2 when taken. When the provider rejects, nothing is saved and the rejection is passed on.
- `update(id, change)` changes the label, the sign-in or both (`ConnectionChange`). A secret left empty keeps the kept one for the same address and deletes it for a new one; a new address gives the connection a new `routingKey`, and a saved sign-in unlocks it. `invalid:connection` for an unknown id.
- `remove(id)` deletes the connection's secrets from the provider and its record. Removing a domain's default makes the next of its kind the default.
- `chooseDefault(domain, id)` picks where new `torrent` or `soulseek` work goes; `invalid:connection` when the id is not a connection serving that domain. Until the person chooses, the first of its kind.
- `routing(domain)` is a `ConnectionRouting`: `all()`, `byId(id)` and `preferred()` (the default, else the first that can serve), each a `RoutedClient` `{ connection, client }`. It is read on every call, and leaves out a connection until `ready` has settled and while it is `locked`.
- `state()` is `{ connections, defaults, locked }`. `locked` lists the ids of connections whose kept sign-in the provider would not hand over when the shell started; a locked connection serves no applet until it is saved again.

The torrent service sends a new torrent to the connection that already holds it for kernl, else to `preferred()`, and keeps each job on its connection by id. The Soulseek service sends searches and browses to `preferred()` and keeps each query and transfer on its connection and `routingKey`. The NZB service is handed every connection as an `NzbDownloader` keyed by `routingKey` and lets the applet choose.

The three services are kehto `ServiceHandler`s. Each takes `appletOf`, `ownerOf`, `ask`, `storage` and `now` (`DownloadServiceDeps`) and its connections, read on every request, so a connection set up, edited or removed while an applet runs is seen at once. What each answers is in [Connected programs](../concepts/download-programs.md) and [Error reasons](../reference/errors.md#download-programs). The `secrets` contract is in [Secrets](../concepts/secrets.md).

### Layouts and the window manager

Everything in this section is also exported from `@kernlize/core/wm`, an entry that imports only `rxjs`. A shell that loads the core on demand, as `apps/web` does, can import its window management up front from there.

Pure `LayoutStrategy` values over `@kehto/wm` types. Minimised windows are never arranged, and rectangles are whole pixels rounded at their edges, so neighbours never overlap or leave a hole.

| Export | Behaviour |
| --- | --- |
| `floatingLayout` | Every window keeps its rectangle. |
| `createDwindleLayout({ gap?, margin? })` | Each window after the first takes half the remaining area, splitting vertically then horizontally in turn. |
| `createColumnsLayout({ gap?, margin? })` | Equal-width columns in window order. |
| `createMasterStackLayout({ ratio?, gap?, margin? })` | The focused window (or the first) takes `ratio` of the width (default 0.6) on the left; the rest stack on the right. |

`gap` is the pixels between windows; `margin` is the pixels between the windows and the container edge and defaults to `gap`.

```ts
import { createMasterStackLayout, type WindowState } from '@kernlize/core';

declare const windows: WindowState[];

createMasterStackLayout({ ratio: 0.5, gap: 8 }).arrange(windows, { x: 0, y: 0, w: 1200, h: 800 });
```

A `LayoutRegistry` holds the layouts a window manager offers, as `LayoutEntry` values: `{ id, label, strategy, freeform? }`.

| Export | Behaviour |
| --- | --- |
| `createLayoutRegistry(entries?)` | A registry holding `entries`, in order. `register(entry)` throws `invalid:duplicate-layout` for an id that is taken; `get(id)` and `list()` read it. |
| `createDefaultLayouts(options?)` | A registry with `floating` (freeform), `dwindle` (labelled "tiled"), `columns` and `master-stack` (labelled "main and stack"). `options` is the `LayoutOptions` for the three that arrange. |

`createWindowManager(options?)` returns a `WindowManager`: placement, focus, stacking, minimising and what the guard is told about each window, with no DOM of its own. [Layouts](../concepts/layouts.md#the-window-manager) describes its behaviour, and `packages/core/features/window-manager.feature` specifies it.

| `WindowManagerOptions` | Default | Meaning |
| --- | --- | --- |
| `layouts` | `createDefaultLayouts()` | The registry on offer. An empty one throws `invalid:no-layouts`. |
| `layout` | the first registered | The id to start in. One that is not registered is ignored. |
| `area` | `{ x: 0, y: 0, w: 1280, h: 800 }` | Where windows are laid out until `setArea` is called. |
| `compactWidth` | `720` | At or below this area width every window fills the area. `0` turns it off. |
| `windowSize` | `{ w: 720, h: 660 }` | The size a new window opens at. |
| `minSize` | `{ w: 280, h: 160 }` | The smallest a window may be made. |
| `onLayout` | none | Called with the id after every `setLayout`. |
| `now` | `Date.now` | Clock for `msSinceFocusGain`. |

| `WindowManager` member | Behaviour |
| --- | --- |
| `state$`, `snapshot()` | The `WindowManagerState`, as an Observable that starts with the current value, and on demand: `windows` (each a `ManagedWindow` of `id`, `rect`, `z`, `focused`, `minimised`, `stopped`, in opening order), `focusedId`, `layout`, `area`, `compact`, `freeform`. |
| `layouts()` | The `{ id, label }` of every layout on offer, read from the registry on each call. |
| `open(id)`, `close(id)` | Add a window in front, focused; remove one and stop reporting to it. Opening an open id brings it to the front. |
| `focus(id)`, `blur()`, `minimise(id)` | Give a window the person's attention, showing it if minimised; take attention from every window; hide one. |
| `move(id, rect)` | Move or resize a window, kept inside the area and no smaller than `minSize`. Ignored unless the state is `freeform`. |
| `stop(id)` | The window's applet was stopped: it loses focus, is reported to no more and waits to be closed. |
| `attach(id, target)` | Report the window's visibility to `target.setVisibility`, now and after every change. An `AppletHandle` is a `VisibilityTarget`. A second call for the same window is ignored. |
| `visibilityOf(id)` | The `WindowVisibility` to answer `KernlHost.getVisibility` with. An unknown window is neither visible nor focused. |
| `setArea(rect)`, `setLayout(id)`, `setPageVisible(visible)` | Change where windows are laid out, which layout arranges them (`invalid:unknown-layout` for an id nobody registered), and whether the page itself can be seen. |
| `destroy()` | Stop reporting and complete `state$`. |

```ts
import { createDefaultLayouts, createWindowManager, type AppletHandle } from '@kernlize/core';

declare const handle: AppletHandle;

const windows = createWindowManager({ layouts: createDefaultLayouts({ gap: 8, margin: 0 }), layout: 'columns' });
windows.setArea({ x: 0, y: 0, w: 1440, h: 900 });
windows.open(handle.windowId);
windows.attach(handle.windowId, handle);
windows.snapshot().windows[0]?.rect; // { x: 0, y: 0, w: 1440, h: 900 }
```

Writing a manager of your own against the `WindowManager` interface, and the one rule it must keep, is in [Write your own window manager](../how-tos/write-a-window-manager.md).

### Web Crypto outside a secure context

Over plain HTTP from an onion or overlay network address, the browser withholds `crypto.subtle` and `crypto.randomUUID`. `installCryptoFallback` fills in whichever is missing, from audited pure-JS primitives, and leaves the platform's own alone ([D-024](../decisions.md#d-024)). Call it once before anything uses Web Crypto; `@kernlize/core/crypto` exports it without the network stack, so a shell can call it first.

```ts
import { installCryptoFallback } from '@kernlize/core/crypto';

installCryptoFallback(); // { randomUUID: false, subtle: false } over HTTPS
```

The fallback `SubtleCrypto` covers SHA-1/256/384/512 digests; HMAC and Ed25519 sign and verify; AES-GCM (128-bit tag) and AES-CBC; X25519 and HKDF `deriveBits`; Ed25519 and X25519 keys in `raw`, `pkcs8` and `jwk`. Anything else rejects with `NotSupportedError`. The mount plan gives every applet frame a `randomUUID` fallback too, before its own scripts; applets do not get the `SubtleCrypto` fallback.

### Event cache

Everything in this section is exported from `@kernlize/core/cache` and from `@kernlize/core`. The cache keeps events between visits, through one contract with a backend per context ([D-030](../decisions.md#d-030)). `createKernl` takes `eventCache`, an opener, and attaches what it opens to the shell's store through `connectEventCache`: the replaceable loader and the store's catalogue ask the cache before any relay, new events are written back in batches, and `destroy()` closes it. The shell starts at once; the cache opens in the background, and one that fails leaves the shell in memory. kernl's web shell passes `() => openEventCache(defaultWebCacheAdapters())`.

```ts
import { EventStore } from 'applesauce-core';
import { attachEventCache, defaultWebCacheAdapters, openEventCache } from '@kernlize/core/cache';

const store = new EventStore();
const cache = await openEventCache(defaultWebCacheAdapters(), {
  onFallback: (name, reason) => console.info(`${name} cache skipped: ${reason}`),
});
const { cacheRequest, stop } = attachEventCache(store, cache);
await cacheRequest([{ kinds: [0], limit: 1 }]); // events marked as from the cache
stop();
await cache.close();
```

| `EventCache` member | Behaviour |
| --- | --- |
| `name` | `sqlite-opfs`, `indexeddb`, `memory`, or the name a custom adapter gave. |
| `add(events)` | Stores events. A replaceable (0, 3, 10000–19999) or addressable (30000–39999, per `d`) event is kept only if it is the newest version, the lower id winning a tie, and the older versions are removed. A kind 5 deletion is stored and removes its author's targets, by `e` id and by `a` address up to its own `created_at`; a target that arrives later is dropped. Ephemeral kinds (20000–29999) are not stored. Writes run one after another. |
| `query(filters)` | Events matching any filter, newest first (the lower id first on a tie), each filter's `limit` applied to that filter. `ids`, `authors`, `kinds`, `since`, `until`, `limit` and single-letter `#x` tags are supported; a filter with `search` matches nothing. |
| `removeByFilters(filters)` | Removes what `query(filters)` returns and resolves how many. |
| `clear()`, `close()` | Removes every event; releases the backend. |

| Export | Behaviour |
| --- | --- |
| `openEventCache(adapters, { onFallback? })` | Opens the first adapter that opens. Each one that rejects is reported as `onFallback(name, reason)`; when none opens, the cache is `memory`. Never rejects. |
| `defaultWebCacheAdapters()` | `[sqlite-opfs, indexeddb, memory]` with default options. |
| `createMemoryCacheAdapter()` | applesauce's `EventMemory`, gone when the page closes. Always opens. |
| `createIndexedDbCacheAdapter({ name?, indexedDB? })` | One object store keyed by id in the database `name` (default `kernl-events`), with indexes on kind, author, time and `name:value` tags. Rejects `unavailable:indexeddb` without a factory, and `unavailable:indexeddb (<error name>)` when the factory refuses, for example a database from a newer version. A write the browser aborts rejects `unavailable:indexeddb (aborted)`. |
| `createSqliteOpfsCacheAdapter(options?)` | sqlite-wasm on the OPFS SAH pool VFS, in a dedicated worker, with applesauce-sqlite's schema. Options below. |
| `fromEventDatabase(name, database, close?)` | Any applesauce `IEventDatabase` or `IAsyncEventDatabase` as a cache, with the rules above applied on top; `close` is called when the cache is closed. See [Add a cache backend](../how-tos/add-a-cache-backend.md). |
| `createEventCache(name, records)` | The rules layer over an `EventRecords` (`put`, `query` for one filter, `remove` by id, `clear`, `close`), for a backend that is not an applesauce database. |
| `attachEventCache(store, cache, { batchTime?, maxBatchSize? })` | Writes the store's new events in batches through applesauce's `persistEventsToCache` (default every 5 s), skipping events from the cache. `cacheRequest(filters)` is a loader `cacheRequest`: it marks what it returns with `markFromCache` and resolves `[]` when the cache rejects. `stop()` ends the writes. |
| `isCorruptionError(error)` | True for `SQLITE_CORRUPT`, `SQLITE_NOTADB`, `database disk image is malformed` and `file is not a database`. |

| `SqliteOpfsOptions` | Default | Meaning |
| --- | --- | --- |
| `filename` | `/kernl-events.sqlite3` | The database in the SAH pool. A rotation moves to `/kernl-events-1.sqlite3`, `/kernl-events-2.sqlite3`, … |
| `storage` | `globalThis.localStorage` | Keeps the current filename at `kernl:event-cache:v1` after a rotation. |
| `locks` | `navigator.locks` | Guards the database. Another tab holding it makes `open` reject `unavailable:locked`. Without a lock manager, the SAH pool's own exclusive handles are the only guard. |
| `connect` | a module worker at `./sqlite-worker.js` | Opens the database files: a `SqliteFiles` (`open(filename)` to a `SqliteDriver` of `exec`, `query`, `close`; `wipe(filename)`; `close()`). Rejects `unavailable:opfs` where the page has no `Worker` or no `navigator.storage.getDirectory`. |
| `onRecover` | none | Told `{ action, reason }` for each repair: `wiped`, `rotated` or `disabled`. |

`open` rejects `unavailable:opfs (…)` when the worker cannot install the SAH pool, `unavailable:worker (…)` when the worker fails, `unavailable:locked`, `unavailable:corrupt` when every repair failed, and `unavailable:sqlite (…)` for any other failure to open. How the cache repairs a damaged database is in [Persistence](../concepts/persistence.md#events-kept-between-visits).

The worker is `dist/sqlite-worker.js`, started with `new Worker(new URL('./sqlite-worker.js', import.meta.url), { type: 'module' })` beside the chunk that starts it; Vite and other bundlers that understand that form bundle it. Exclude `@sqlite.org/sqlite-wasm` from the bundler's dependency pre-bundling so its `sqlite3.wasm` resolves next to it.

## Exports

Signatures are abbreviated; the generated reference has the full ones.

### Composition

| Export | Signature | Description |
| --- | --- | --- |
| `createKernl` | `(options: KernlOptions) => Kernl` | The composition root described above. |
| `toSession` | `(account: IAccount) => Session` | Describes an account for the UI; `readOnly` when it cannot sign. |
| `createAppletLifecycle` | `(context: LifecycleContext) => AppletLifecycle` | `resolve`, `plan`, `mount`, `applets`, `handleWindowMessage` over the composed parts. |
| `grantNarrowingReason` | `(plan: MountPlan, record: GrantRecord, baseline: readonly string[]) => 'blocked' \| 'grant-narrowed' \| undefined` | Why a grant change stops a running window: the applet is blocked, or its grant no longer covers a domain the window was started with. `mount` uses it on every `grants.changes$`, and the preview does too. |
| `resolveWindow` | `(handles: ReadonlyMap<string, MountedApplet>, event: MessageEvent) => WindowResolution \| null` | The sending window from `originRegistry`, never from the message. |
| `createShellAdapter` | `(deps: ShellAdapterDeps) => ShellAdapter` | kehto's adapter from kernl's parts, with the fixed choices listed under Composition. `deps.consent` (a `SigningConsent`), `deps.filterNappletMessage`, `deps.getFocusContext` and `deps.permissions` (kehto's `PermissionAdapter`, from `createFirewallPermissions`) are required; the adapter always sets `aclDefaultPolicy: 'restrictive'`. |
| `createKernlServices` | `(deps: KernlServiceDeps) => KernlServices` | `{ registry, theme, dm }` with kehto's nine reference services wired. `deps.consent` is required; `outbox.publish` passes it before signing, and a refusal is answered as `outbox.publish.result` with `ok: false` and the reason. |
| `isTheme` | `(value: Record<string, unknown> \| undefined) => value is Theme` | True when `colors.background`, `colors.text` and `colors.primary` are strings. |
| `resourceInitFor` | `(deps, init: ResourceFetchInit) => ResourceResolveInit` | Names the requesting applet, or `'shell'`, to the bridge resolver. |
| `resourceErrorFor` | `(error: unknown) => ResourceServiceError` | The NAP-RESOURCE error a bridge rejection becomes: `unavailable:no-bridge` is `unsupported-scheme`, `unavailable:not-found` and `unavailable:no-servers` are `not-found`, `unavailable:timeout` is `timeout`, `denied:too-large` is `too-large`, any other `invalid:` is `invalid-request`, any other `denied:` is `blocked-by-policy`, and the rest `network-error`. The message is the bridge's reason ([D-055](../decisions.md#d-055)). |
| `fetchThroughFirewall` | `<T>(url: string, init: Pick<ResourceFetchInit, 'signal' \| 'authorizeNetwork'>, run: (signal: AbortSignal) => Promise<T>) => Promise<T>` | Has the firewall approve the origin of an `http:` or `https:` address before `run` contacts it; any other address goes straight to `run`. Only the first origin is put to the firewall: the bridge registry follows redirects under its own policy. |
| `shellRelayOrigins` | `(tiers: Pick<RelayTiers, 'get'>) => readonly string[]` | Every relay in the shell's tiers as a distinct bare `ws:` or `wss:` origin: the relay plan kehto's `dm` and social services have approved before a request runs. |
| `acceptAnyRelay` | `(router: OutboxRouter) => OutboxRouter` | An outbox publish, planned or not, is `ok` when any relay accepted it ([D-028](../decisions.md#d-028)). |
| `LINK_PROTOCOLS` | `readonly string[]` | `['https:', 'mailto:']`. |
| `PACKAGE_NAME` | `'@kernlize/core'` | |
| `KERNL_FRAME_POLICY_META` | `string` | kehto's `<meta>` for the host page's `<head>`, so applet frames cannot navigate away from their `srcdoc`. |
| `Kernl`, `KernlOptions`, `KernlHost`, `GuardFacade`, `Session`, `StorageLike`, `MessagingBackendFactories`, `AppletLifecycle`, `LifecycleContext`, `ShellAdapterDeps`, `KernlServiceDeps`, `KernlServices` | types | |

### Applets

| Export | Signature | Description |
| --- | --- | --- |
| `decodePointer` | `(input: string) => AppletPointer` | Address text to `{ kind: 'address' \| 'event' \| 'builtin', … }`; throws `invalid:pointer`. |
| `resolveBuiltin` | `(builtins: readonly BuiltinApplet[], id: string) => Promise<ResolvedApplet>` | Load an applet the host ships and check it against its pinned hash; throws `invalid:pointer`, `unavailable:blob` or `invalid:artifact-hash`. |
| `builtinAddress` | `(id: string) => string` | `'kernl:messages'` for `'messages'`. |
| `BUILTIN_PUBLISHER` | `string` | The all-zero key shown as the publisher of an applet nobody published. It cannot sign, so it never collides with a real publisher. |
| `BuiltinApplet` | interface | `{ id; title; description; sha256; requires; optional; archetypes?; grants?; load(): Promise<string> }`, an entry of `KernlOptions.builtins`. |
| `PublishedPointer` | type | `AppletPointer` without the `builtin` kind: what `fetchManifestEvent` can look up. |
| `fetchManifestEvent` | `(pool: ApplesaucePool, tiers: RelayTiers, pointer: PublishedPointer, timing?: Partial<ManifestTiming>) => Promise<NostrEvent>` | Newest manifest from the hints plus the `apps` tier, then from the `super` tier; throws `unavailable:manifest` when the relays had none, `unavailable:unreachable` when no relay opened a connection, and `unavailable:network` when none answered in time. |
| `defaultFetchBlob` | `(sha256: string, servers: readonly string[], fetchImpl?: typeof fetch) => Promise<Uint8Array>` | Tries each server with a `BLOB_TIMEOUT_MS` (20 000 ms) budget; throws `unavailable:blob`. |
| `openDefaultArtifactCache` | `() => Promise<NappletArtifactCache \| undefined>` | kehto's verified-artifact cache over Cache Storage, or nothing. |
| `resolveApplet` | `(options: ResolveAppletOptions) => Promise<ResolvedApplet>` | kehto's `resolveNapplet` with kernl's reasons: `unavailable:blob` or `invalid:<code>`. |
| `summarize` | `(resolved: ResolvedNapplet, address: string) => AppletSummary` | The verified manifest reduced to what the shell shows, with its shareable address. |
| `planMount` | `(options: PlanMountOptions) => MountPlan` | Environment, narrowed to `options.domains` when the firewall admitted fewer, CSP-prepared `srcdoc` with kehto's nested-context lock and kernl's insertion lock, `missingRequired`. No DOM. Throws `denied:nested-frame` when kehto's `assertNappletHasNoFrame` finds a frame in the verified markup, and `unavailable:frame-lock` when kehto's CSP meta and prelude are not where it expects them ([D-014](../decisions.md#d-014)). |
| `resolveAppletEnvironment` | `(adapter: ShellAdapter, summary: Pick<AppletSummary, 'identity'>) => ShellEnvironment` | The environment the grants leave an applet, before the firewall admits it. |
| `mountApplet` | `(plan: MountPlan, frame: FrameLike, deps: MountDeps) => MountedApplet` | The NIP-5D mount order; throws `invalid:frame-detached`. Calls `frame.setAttribute('sandbox', 'allow-scripts')`. |
| `CONTROLLER_DENY_POLICY` | `string` | `gamepad 'none'; hid 'none'; usb 'none'`. |
| `BLOB_TIMEOUT_MS` | `20_000` | |
| `MANIFEST_TIMING` | `ManifestTiming` | `{ settleMs: 3_000, patienceMs: 8_000, timeoutMs: 10_000, retryDelayMs: 1_000 }`, the waits of one round of a manifest lookup. |
| `AppletPointer`, `AppletSummary`, `AppletIdentity`, `MountPlan`, `AppletHandle`, `AppletStatus`, `FrameLike`, `ResolveAppletOptions`, `ResolvedApplet`, `PlanMountOptions`, `MountDeps`, `MountGuardHooks`, `MountedApplet`, `ManifestTiming` | types | `MountedApplet` adds `revoked(reason)` to `AppletHandle` for the bridge's revocation hook. `FrameLike.sandbox` is optional and not read: the mount replaces the attribute whatever it held. |

### Store and intents

| Export | Signature | Description |
| --- | --- | --- |
| `streamCatalog` | `(pool: ApplesaucePool, tiers: RelayTiers, options?: LoadCatalogOptions) => Observable<readonly CatalogEntry[]>` | Root and named manifests from `catalogRelays(tiers)`, signature-checked, newest per catalogue id, emitted again as relays answer (at most every `emitMs`, `CATALOG_EMIT_MS`, 120). A manifest its publisher deleted (kind 5, NIP-09) is left out. Completes when every relay finished, or after `timeoutMs` (`CATALOG_TIMEOUT_MS`, 30000), the outer bound; a failing relay never discards what others sent. Asks for `limit` (`CATALOG_LIMIT`, 500) per relay. |
| `loadCatalog` | `(pool: ApplesaucePool, tiers: RelayTiers, options?: LoadCatalogOptions) => Promise<readonly CatalogEntry[]>` | The last list `streamCatalog` emits. |
| `catalogRelays` | `(tiers: RelayTiers) => readonly string[]` | The `apps` tier, then `super`. |
| `toCatalogEntry` | `(event: NostrEvent, relays?: readonly string[]) => CatalogEntry \| undefined` | A store entry from a manifest whose signature verifies; undefined otherwise. |
| `addressOf` | `(event: NostrEvent, relays?: readonly string[]) => string` | `naddr1…` for a root or named manifest, `nevent1…` for a snapshot. |
| `newestEntries` | `(entries: readonly CatalogEntry[]) => readonly CatalogEntry[]` | One entry per catalogue id, newest first. |
| `searchCatalog` | `(entries, query?: CatalogQuery) => readonly CatalogEntry[]` | Text (every word must match), `topics`, `available` domains and `convention` filters, best first. |
| `fuzzyScore` | `(word: string, field: string) => number` | 4 whole word, 3 prefix, 2 substring, 1 letters in order within one word, 0 none. |
| `popularTopics` | `(entries, limit?: number) => readonly TopicCount[]` | Topics by count, then name; 12 by default. |
| `createInstalledApplets` | `(storage: StorageLike, now?: () => number) => InstalledApplets` | The installed set at `kernl:installed:v1`; `catalog()` is what kehto's resolver loads. |
| `createHandlerDefaults` | `(options: HandlerDefaultsOptions) => HandlerDefaults` | Local defaults, the account's published preferences (kind 31129) and opt-in publishing to `preferenceRelays(tiers)`. |
| `preferenceRelays` | `(tiers: RelayTiers) => readonly string[]` | The `outbox` tier, then `super`. |
| `HANDLER_PREFERENCES_KIND` | `31129` | |
| `parseHandlerPreferences` | `(event: NostrEvent) => HandlerPreferences \| undefined` | The public `a`, `e` and `i` entries; malformed entries are ignored. |
| `preferredHandlers` | `(preferences, convention: string) => readonly string[]` | Catalogue ids: intent-specific entries when any, else archetype-wide ones. |
| `preferenceTemplate` | `(previous, archetype, catalogId, now) => EventTemplate \| undefined` | The next preference event with one handler first, every other tag and the content kept. |
| `catalogIdForRef`, `refForCatalogId` | `(value: string) => string \| undefined` | Between preference references (`35129:<pubkey>:<d>`, `15129:<pubkey>:`, a snapshot id) and kehto's catalogue ids. |
| `createIntentRouter` | `(options: IntentRouterOptions) => IntentRouter` | kernl's routing over kehto's `createCatalogIntentResolver`: defaults, preferences, chooser, store fallback with a one-time authorisation. |
| `createIntentDelivery` | `(options: IntentDeliveryOptions) => (params) => Promise<void>` | Reuse or open the handler, retry until it can receive (`DELIVERY_RETRY`, 100 ms × 150), send `intent.deliver`. Throws `unavailable:handler`, `unavailable:window` or `unavailable:delivery`. |
| `createKernlIntents` | `(deps: KernlIntentDeps) => KernlIntents` | The composition `createKernl` uses: the `intent` service handler, the `Intents` facade and the installed set. |
| `CatalogEntry`, `CatalogQuery`, `TopicCount`, `LoadCatalogOptions`, `AppletCatalog`, `InstalledApplet`, `InstalledApplets`, `InstalledContract`, `HandlerDefaults`, `HandlerDefaultsOptions`, `HandlerPreferences`, `PreferenceSigner`, `Intents`, `IntentRouter`, `IntentRouterOptions`, `IntentDeliveryOptions`, `KernlIntentDeps`, `KernlIntents`, `HandlerPrompt`, `HandlerOption`, `HandlerChoice` | types | |

### Guard

| Export | Signature | Description |
| --- | --- | --- |
| `createGuardPipeline` | `(options: GuardPipelineOptions) => GuardPipeline` | Ingress guard, visibility gate and focus-aware rate limiter in front of the bridge; `handleWindowMessage` for window-level messages, `observe` for port traffic, which returns kehto's `NappletMessageDecision` (`dispatch`, `defer` for a hidden window's non-control envelope, `drop` for what the guard will not let through). `onRelease(windowId)` is called when a window becomes visible. |
| `createRuntimeRateLimiter` | `(config: () => GuardConfig) => TemporalPolicy` | The limiter for kehto's `permissions.rateLimiter`: the guard profile's budget for each operation class, read on every charge. Where kehto only observes, a spent budget flags and never blocks. No startup burst. |
| `runtimeOpClass` | `(operation: string) => OpClass` | The guard class for an operation as the runtime names it: `classifyEnvelope({ type: operation })`. Deletions share `relay:publish` here. |
| `toGuardEvent` | `(event: PermissionRateEvent, napplet: string, at: number) => GuardEvent` | A runtime budget event in the guard's words: `rate:<class>`, or `flood:prompts` for a question dropped because the applet asked too often. It carries nothing the applet sent. |
| `GuardPipeline`, `GuardPipelineOptions`, `PipelineDisposition`, `WindowResolution` | types | `PipelineDisposition` is `GuardDisposition \| 'unrouted'`, the answer for window-level messages. |

Removed ([D-056](../decisions.md#d-056)): `runtimeFirewallRules`, `applyRuntimeFirewallRules`, `applyRuntimeFirewallProfile`, `createRuntimeFirewallHooks`, `RUNTIME_FIREWALL_STORAGE_KEY`, `RUNTIME_OP_CLASSES` and the types `RuntimeFirewallRules`, `RuntimeRateRule`, `RuntimeFirewallState`, `RuntimeFirewallHooks` and `RuntimeFirewallHooksOptions`.

### Firewall

| Export | Signature | Description |
| --- | --- | --- |
| `defaultFirewallRules` | `() => PermissionRules` | The shipped rules: `default: 'allow'`, `link.open` set to `ask`. |
| `createFirewallRules` | `(storage: StorageLike) => FirewallRules` | The user's rules over the host storage: `current`, `rules$`, `set(target, action)` (throws `invalid:rule`), `restoreDefaults`, `decide(request, missing)` (kehto's `defaultDecision`) and `allows(principal, requirement)`. A damaged stored document reads as the shipped rules. |
| `FIREWALL_RULES_STORAGE_KEY` | `'kernl:firewall-rules:v1'` | Where the rules are kept. |
| `createFirewallPermissions` | `(options: FirewallPermissionsOptions) => PermissionAdapter` | kehto's approval adapter for `ShellAdapter.permissions`: the rules decide first, `host.presentApproval` is asked when they say to ask, a host without it has such a request refused, and a question for an applet this shell did not plan is cancelled. Options: `{ host, rules, appletOf, rateLimiter, onRateLimit }`. |
| `permissionPrincipalFor` | `(summary: Pick<AppletSummary, 'identity' \| 'manifest'>) => PermissionPrincipal` | `{ kind: 'verified', manifestKey, artifactHash }` from the verified manifest: the catalogue id rules follow, and the hash answers are tied to. |
| `FIREWALL_DECISIONS_STORAGE_KEY` | `'kernl:firewall-decisions:v1'` | Where the answers the user asked to keep are stored. |
| `FIREWALL_PROMPT_TIMEOUT_MS` | `600000` | How long a question may wait, queue time included. kehto's own default is a minute. |
| `describeApproval` | `(prompt: Pick<ApprovalPrompt, 'missing' \| 'allowLifetimes'>, applet: FirewallApplet) => FirewallSummary` | kehto's prompt as what the host shows. A link offers `allow-once` and `deny` only; anything else offers each lifetime kehto allows. |
| `answerFor` | `(summary: Pick<FirewallSummary, 'choices'>, choice: FirewallChoice \| undefined) => ApprovalAnswer` | kehto's answer for the user's choice; a dismissal, or a choice the summary did not offer, cancels and stores nothing. |
| `createAppletAdmissions` | `(runtime: AdmissionRuntime, now: () => number) => AppletAdmissions` | Admits applets through the firewall before they run: `admit(windowId, summary, environment)` resolves the domains the applet starts with, or throws `denied:firewall` or `unavailable:firewall`; `isCurrent`, `mounted`, `discard`, `onInvalidated`, `close`. |
| `MAX_UNMOUNTED_PLANS` | `16` | How many planned windows may wait to be mounted; past it the oldest plan is dropped. |
| `createFirewall` | `(options: FirewallOptions) => KernlFirewall` | The `Firewall` surface over the rules and kehto's grant store (`bridge.runtime.permissions`), plus `touch()` and `close()`. Changing a rule takes back every answer the rules gave that they no longer give. |
| `Firewall`, `FirewallRuleTarget`, `FirewallDecision`, `FirewallPrompt`, `FirewallSummary`, `FirewallRequest`, `FirewallApplet`, `FirewallChoice`, `FirewallRules`, `FirewallPermissionsOptions`, `AdmissionRuntime`, `AppletAdmissions`, `FirewallOptions`, `KernlFirewall` | types | |

### Grants and consent

| Export | Signature | Description |
| --- | --- | --- |
| `createGrants` | `(options: GrantsOptions) => KernlGrants` | The grants surface over `bridge.runtime.aclState`, persisted at `kernl:grants:v1`. |
| `createEnvironmentResolver` | `(grants: Grants) => CapabilityHooks['resolveEnvironment']` | Baseline plus allowed domains; `shell` only when blocked. |
| `BASELINE_DOMAINS` | `readonly string[]` | `['shell', 'inc', 'theme', 'storage', 'keys']`. |
| `DOMAIN_CAPABILITIES` | `Readonly<Record<string, readonly Capability[]>>` | The table above. |
| `capabilitiesForDomain` | `(domain: string) => readonly Capability[]` | Empty for unknown domains. |
| `capabilitiesForDomains` | `(domains: readonly string[]) => readonly Capability[]` | Union in table order. |
| `MESSAGES_DOMAIN` | `'dm'` | The domain whose grant seals an applet. |
| `MESSAGE_COMPANION_DOMAINS` | `readonly string[]` | `['shell', 'dm', 'identity', 'theme', 'storage', 'config', 'notify', 'keys', 'intent']`: all that may be in force together with messages. |
| `sealsApplet` | `(granted: readonly string[]) => boolean` | Whether the grants include messages. |
| `domainsInForce` | `(granted, baseline?) => readonly string[]` | Baseline plus grants, cut to the companions when sealed. |
| `withheldDomains` | `(granted, baseline?) => readonly string[]` | What the seal keeps out of force. |
| `capabilitiesInForce` | `(granted: readonly string[]) => readonly Capability[]` | What is written to the ACL; no `intent:write` when sealed. |
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
| `parsePerson` | `(input: string) => PersonPointer \| undefined` | Reads hex, `npub` or `nprofile` (with or without `nostr:`) into a key and the servers named with it. Anything else is not a person ([D-045](../decisions.md#d-045)). |
| `createPeople` | `(options: PeopleOptions) => People` | `parse`, and `locate(input)`, which first asks the servers an `nprofile` names for the person's profile, server list and inboxes; throws `invalid:person`. Exposed as `kernl.people`. |
| `locateRecipients` | `(adapter: DmAdapter, people) => DmAdapter` | Reads every recipient of a send through `people.locate`; `invalid:recipient` when one is not an identity. |
| `locateSendRecipients` | `(service: DmService, people: Pick<People, 'locate'>) => DmService` | Reads a `dm.send`'s recipients before kehto's service sees them, because under the firewall kehto has every recipient approved and takes hex keys only; answers `invalid:recipient` when one is not an identity. |
| `PERSON_HINT_TIMEOUT_MS` | `8000` | Outer bound on waiting for hinted servers. |
| `createThrowawayIdentity` | `(name?: string) => ThrowawayIdentity` | A fresh key held in memory, for trying the shell. Signs like any identity; never persisted ([D-044](../decisions.md#d-044)). |
| `ThrowawayIdentity` | class extends `BaseAccount` | `toJSON` throws `denied:plaintext-key-persistence`, so persistence skips it. |
| `THROWAWAY_IDENTITY_TYPE` | `'throwaway'` | Its account type. |
| `PLAINTEXT_KEY_ACCOUNT_TYPES` | `readonly string[]` | `['nsec', 'seed-words']`. |
| `createAuthHooks` | `(accounts: AccountManager, consent: SigningConsent) => AuthHooks` | kehto's auth over the account manager; a signer asked for with a window id passes `consent` before signing. |
| `wrapAccountSigner` | `(account: IAccount) => Signer` | The NIP-07-shaped signer kehto expects. |
| `isReadOnlyAccount` | `(account: IAccount) => boolean` | True for `ReadonlyAccount`. |
| `createReplaceableLoader` | `(store: EventStore, pool: ApplesaucePool, tiers: RelayTiers) => AddressPointerLoader` | The applesauce address loader for replaceable and addressable events the store lacks: it asks the pointer's relays, then `lookupRelaysOf(tiers)` (the `discovery` tier, then `super`), and adds what it finds to the store. Used by `createIdentityProviders` and the consent lookup. |
| `createIdentityProviders` | `(store: EventStore, pool: ApplesaucePool, tiers: RelayTiers, options?: IdentityProviderOptions) => IdentityProviders` | Profile, follows, mutes and relays from the store, loaded once from the lookup relays on a miss; lists, zaps, blocked and badges are empty. |
| `createRelayPoolHooks` | `(pool: ApplesaucePool, tiers: RelayTiers) => RelayPoolHooks` | kehto's relay-pool hooks, including one scoped relay per window. |
| `createRelayPoolLike` | `(pool: ApplesaucePool) => RelayPoolLike` | `subscription`, `request`, `publish` over the one pool. |
| `createAppletRelayBackend` | `(pool: ApplesaucePool, tiers: RelayTiers) => RelayPoolServiceOptions` | For kehto's `createRelayPoolService`; `publishToRelays` publishes to the planned relays, `publish` to the tier for the event's kind, and both succeed when any relay accepts. |
| `createAppletRelayService` | `(pool: ApplesaucePool, tiers: RelayTiers) => RelayPlanningServiceHandler` | kehto's relay service over that backend, planning each publish onto the tier for its kind; an applet's relay hint is planned as kehto plans it. |
| `publishAccepted` | `(pool: ApplesaucePool, relays: string[], event: NostrEvent) => Promise<number>` | Publishes everywhere and resolves with how many accepted; throws `unavailable:not-accepted:0/<n>` only when none did (D-028). |
| `lookupRelaysOf` | `(config) => string[]` | Where an unhinted replaceable is looked up: `discovery`, then `super`. |
| `createProfiles` | `(options: ProfilesOptions) => Profiles` | `card$(pubkey)` streams a `ProfileCard` (name, `https:` picture, address, about, `found`) and starts a lookup on the lookup relays, then on the author's own write relays when their relay list names servers the lookup relays lacked. Nothing times out; a late profile replaces the short key. `card(pubkey)` reads the store only. `settled(pubkey)` resolves once the profile is found or every lookup server has answered, never on a timer. |
| `createAccountFileServers` | `(options: AccountFileServersOptions) => AccountFileServers` | The account's file servers (BUD-03, kind 10063): `state$`, `state()` (`loading`, `missing` with the defaults, `found`), `current()` (waits only while the list is looked up), `save(servers) => Promise<PublishOutcome>` (publishes to the outboxes and lookup servers; `denied:read-only`, `invalid:server-url`). `kernl.files` is one (D-033). |
| `DEFAULT_FILE_SERVERS`, `fileServersFromEvent`, `fileServerTags` | constant and helpers | The fallback servers, the servers a list names in order, and the tags of a new list with every other tag kept. |
| `createBlossomUploader` | `(options: BlossomUploaderOptions) => Uploader` | kehto's `Uploader` over `blossom-client-sdk`: asks `ask(windowId, details)` once per file before anything is signed or sent, signs one authorization, uploads to the first server and mirrors to the rest; success when any server stores it, with every copy in `fallbackUrls` and NIP-94 tags. Refusals: `denied:read-only`, `denied:consent` (cancelled), `unavailable:no-file-server`, `unavailable:not-accepted:0/<n>`. `transfer` is injectable. |
| `describeUpload`, `askUploadConsent`, `sizeWords` | helpers | The `public` consent summary for an upload, the host prompt that refuses an unnamed applet without asking, and sizes in words. |
| `createAppletConfig` | `(options: AppletConfigOptions) => ConfigServiceOptions` | kehto's NAP-CONFIG hooks (D-036). `options` is `{ storage, appletOf(windowId), present(prompt) }`. Values are kept per applet catalogue id in `kernl:applet-config:v1`, so an update keeps them, and only the host's form writes them. `openSettings` calls `present` with a `SettingsPrompt`. `createKernl` registers it when the host has `presentSettings`, and only then offers the `config` domain. |
| `createCommonActions`, `commonActionsFor` | `(options: CommonActionsOptions) => CommonServiceOptions` | kehto's NAP-COMMON hooks (D-035). `getProfile` takes a key or shared address. `follows` reads the current list. `follow`/`unfollow` change the kind 3 list through the signing gate, keeping every other entry, tag and the content. `react` (kind 7) and `report` (kind 1984) publish. Writes succeed when any relay accepts, and a read-only session gets `denied:read-only`. `createKernl` registers them, so the `common` domain is offered. |
| `labelConversations` | `(adapter: DmAdapter, profiles: Pick<Profiles, 'settled'>) => DmAdapter` | Names every conversation participant the `dm` domain lists from their profile; a provider's own label is kept, and a person with no profile keeps none. `createKernlServices` applies it when given `profiles`, so messaging applets show names without looking anyone up. |
| `toProfileCard` | `(pubkey: string, event: NostrEvent \| undefined) => ProfileCard` | Display name, then name, then the abbreviated key. |
| `createRemoteToolsService` | `(options: RemoteToolsOptions) => ServiceHandler` | The `cvm` service: one kehto tool service and transport per window, calling under that window's key; closing or revoking a window closes its transport and wipes its key ([Remote tools](#remote-tools)). |
| `createCvmRelayPool` | `(pool: ApplesaucePool) => CvmRelayPool` | kehto's tool transport relay surface over the one pool: subscriptions end in one `EOSE`, and a publish succeeds when any relay accepts. |
| `createWindowIdentities` | `() => WindowIdentities` | `signer(windowId)` is the window's applesauce `PrivateKeySigner`, made on first use; `release(windowId)` overwrites its key with zeros and forgets it. |
| `RemoteToolsOptions`, `RemoteToolsSettings`, `WindowIdentities` | types | `RemoteToolsSettings` is `KernlOptions.remoteTools`: `relays` and `registry`. |
| `createShortcutsService` | `(options: ShortcutsOptions) => ShortcutsService` | The `keys` service (D-054): kehto's `createKeysService` behind kernl's own key listener, which passes on only presses the shell did not use (not handled, not composed, not aimed at a field, button or link), sends `keys.action` only to the window `isFocused(windowId)` accepts, and prevents the page's default for a key that ran an action. `destroy()` removes the listener. |
| `createForwardedKeys`, `KEY_REPEAT_WINDOW_MS` | `() => ForwardedKeys` | `drops(windowId, message, focused, at)` is true for a `keys.forward` from a window that is not focused, and for the same key forwarded again within 600 ms, which is a held key repeating. The pipeline asks before anything is counted. |
| `createKeymapHold` | `(options: KeymapHoldOptions) => KeymapHold` | `holds(windowId, message, at)` is true for a `keys.registerAction` or `keys.unregisterAction` in a window's first `startupMs()`; one timer per window then calls `release(windowId)`. `holding(windowId)` and `forget(windowId)`. |
| `ShortcutKey`, `ShortcutSettings`, `ShortcutsOptions`, `ShortcutsService`, `ForwardedKeys`, `KeymapHold`, `KeymapHoldOptions` | types | `ShortcutSettings` is `KernlOptions.shortcuts`: `reserved`, chords such as `'Alt+/'` that are never bound for an applet, and `target`, where key presses are heard (`document` by default). `ShortcutsOptions` adds `isFocused`. |
| `createMultiplayerSettings`, `validFamily` | `(storage: StorageLike) => MultiplayerSettings`, `(family) => boolean` | The person's settings above, and the rule a family must meet to be kept. |
| `discoverToolFamilies`, `TOOL_DISCOVERY_TIMEOUT_MS` | `(input: string, options: ToolDiscoveryOptions) => Promise<ToolFamilyCandidate[]>` | The search above; `options` is `{ pool, relays, fetch, timeoutMs? }`. |
| `mergeFamilies` | `(host, own) => CvmRegistryFamily[]` | The host's families and the person's, the person's taking the place of the host's with the same label and provider. |
| `KernlMultiplayer`, `MultiplayerSettings`, `MultiplayerState`, `ToolDiscoveryOptions`, `ToolFamilyCandidate` | types | |
| `createDirectConnectionsService` | `(options: DirectConnectionsOptions) => ServiceHandler` | The `webrtc` service: one kehto WebRTC service per window over `createDirectSignaling`, with kernl's approval step (grant, then `options.ask`); closing or revoking a window ends its sessions and wipes its key ([Direct connections](#direct-connections)). |
| `createDirectSignaling` | `(options: DirectSignalingOptions) => WebrtcServiceOptions` | kehto's WebRTC hooks speaking `soy-rtc/1` for one window: `planOpen`, `open`, `send`, `close`, `destroyWindow`, `revokeWindow`. |
| `describeDirectConnection` | `(requirements: readonly PermissionRequirement[], applet: AppletIdentity) => ConsentSummary` | The `direct` prompt for one session: with whom, what they learn, what the shell cannot see, who introduces and helps, and the new name. |
| `directNamespace` | `(summary) => string` | `<publisher>:<kind>:<name>` from the catalogue id; the same for every version of a named applet. |
| `DIRECT_SIGNALING_PROFILE`, `DIRECT_SIGNAL_KIND`, `DIRECT_MAX_PAYLOAD_BYTES` | constants | `'soy-rtc/1'`, `25050`, `16384`. |
| `DirectConnectionsOptions`, `DirectConnectionsDeps`, `DirectConnectionsSettings`, `DirectIceServer`, `DirectSignalingOptions`, `SignalRelay`, `SignalSigner` | types | `DirectConnectionsSettings` is `KernlOptions.directConnections`: `relays`, `iceServers`, `createPeer`. |
| `createDmRelayPool` | `(pool: ApplesaucePool, tiers: RelayTiers) => DmRelayPool` | For messaging backends. |
| `createOutboxRelayPool` | `(pool: ApplesaucePool) => OutboxRelayPoolLike` | For kehto's `createRelayPoolOutboxRouter`, with per-relay publish outcomes. |
| `SHELL_RELAY_OPTIONS` | `RelayPoolOptions` | The options the shell's own `RelayPool` is built with: one redial after a second for publishes and requests, since applesauce-relay 7.1 otherwise redials a refused relay three times ([D-037](../decisions.md#d-037)). A host passing its own `pool` chooses its own. |
| `subscribeWithEose` | `(pool: Pick<ApplesaucePool, 'req'>, relays: string[], filters: NostrFilter[], callback: (item: NostrEvent \| 'EOSE') => void) => EoseSubscription` | Each event once, one `EOSE` after every relay answered or failed. |
| `selectRelayTier` | `(tiers: RelayTiers, filters: readonly NostrFilter[]) => string[]` | The routing rule under Relay tiers. |
| `createRelayTiers` | `(storage: StorageLike, defaults?: Partial<Record<RelayTier, readonly string[]>>) => RelayTiers` | Persisted at `kernl:relays:v1`; `changes$` replays the current value. |
| `DEFAULT_RELAY_TIERS` | `Readonly<Record<RelayTier, readonly string[]>>` | The table above. |
| `ApplesaucePool`, `EoseSubscription`, `OutboxRelayPoolLike`, `IdentityProfile`, `IdentityProviderOptions`, `IdentityProviders`, `RelayPermissions`, `RelayTier`, `RelayTiers` | types | `ApplesaucePool` is `Pick<RelayPool, 'req' \| 'request' \| 'publish'>` so tests can supply a fake. |

### Servers and mailboxes

Not yet composed by `createKernl`; [Inbox, outbox and finding servers](../concepts/inbox-outbox-and-servers.md) explains them.

| Export | Signature | Description |
| --- | --- | --- |
| `summarizePublish` | `(responses: readonly PublishAnswer[]) => PublishOutcome` | `{ accepted, refused: { url, reason }[], ok }` from `RelayPool.publish`'s answers; `ok` when any relay accepted, a relay counts once, an acceptance wins ([D-028](../decisions.md#d-028)). |
| `describeOutcome` | `(outcome: PublishOutcome) => string` | `Saved to 2 of 3 relays`, `Saved to all 3 relays`, `Saved to 1 relay`, `No relay accepted it`, `There was no relay to save it to`. Never the relay's reason. |
| `toRelayUrl` | `(url: string) => string \| undefined` | The normalised `ws:`/`wss:` URL, or undefined for anything else. |
| `relayUrls` | `(urls: Iterable<string>) => string[]` | Normalised, deduplicated, non-URLs dropped. |
| `createRelayDirectory` | `(options: RelayDirectoryOptions) => RelayDirectory` | NIP-66 reports (kind 30166) streamed from `options.relays` (`DEFAULT_MONITOR_RELAYS`), folded per relay; `listings$`, `listings()`, `search(text, limit?)`, `suggest({ purpose, exclude?, limit? })`, `start()`, `stop()` ([D-029](../decisions.md#d-029)). Options: `pool` (`DirectoryPool`, `Pick<RelayPool, 'subscription'>`), `relays` (array or Observable), `maxAgeSeconds` (two days), `now`, `fallback`, `throttleMs` (250). |
| `DEFAULT_MONITOR_RELAYS` | `readonly string[]` | `wss://relay.nostr.watch`, `wss://relaypag.es`, `wss://monitorlizard.nostr1.com`. |
| `DEFAULT_SUGGESTIONS` | `Readonly<Record<SuggestPurpose, readonly string[]>>` | The fallback per purpose: `relay.damus.io`, `nos.lol`, `relay.primal.net` for `inbox` and `outbox`; `purplepag.es`, `user.kindpag.es`, `indexer.coracle.social` for `lookup`. |
| `createAccountMailboxes` | `(options: AccountMailboxesOptions) => AccountMailboxes` | The active account's kind 10002 list: `state$`, `state()` (`loading`, `missing` with `suggested`, `found` with `mailboxes` and `event`) and `save(next, onProgress?) => Promise<PublishOutcome>`; with `onProgress` and a pool that has `event()`, the outcome so far is reported as each server answers, the list enters the store once one server holds it, and a server that never answers counts as refusing with `no answer`. Options: `store`, `pool` (`MailboxPool`, `Pick<RelayPool, 'req' \| 'publish'>` and optionally `event`), `pubkey$`, `lookupRelays`, `signer` (`MailboxSigner`), `directory?`, `patienceMs?` (15 000). `save` rejects with `denied:read-only` or `invalid:relay-url`. |
| `mailboxesFromEvent` | `(event: NostrEvent \| undefined) => Mailboxes` | `{ inboxes, outboxes }`; an unmarked `r` tag is both. |
| `mailboxTags` | `(mailboxes: Mailboxes, previous?: NostrEvent) => string[][]` | `r` tags, unmarked for a relay in both lists, then the previous list's other tags. |
| `PublishOutcome`, `PublishAnswer`, `RelayDirectory`, `RelayDirectoryOptions`, `RelayListing`, `SuggestOptions`, `SuggestPurpose`, `DirectoryPool`, `AccountMailboxes`, `AccountMailboxesOptions`, `MailboxState`, `Mailboxes`, `MailboxPool`, `MailboxSigner` | types | `RelayListing` is `{ url, monitors, lastSeen, rttOpen?, rttRead?, rttWrite?, network?, nips, types, requiresAuth, requiresPayment, restrictedWrites }`. |

### Download programs and secrets

| Export | Signature | Description |
| --- | --- | --- |
| `createDownloadClients` | `(options: DownloadClientsOptions) => DownloadClients` | The person's connections and the routing built from them, described above. |
| `DownloadClientsOptions` | interface | `{ storage: StorageLike; secrets?: SecretsProvider; pageScheme?: () => PageScheme; fetch?: ClientFetch }`. `secrets` is `createStorageSecrets(storage)` by default, `pageScheme` is `currentPageScheme`, `fetch` is the global one. |
| `DownloadClients` | interface | `state$`, `state()`, `ready`, `check`, `add`, `update`, `remove`, `chooseDefault`, `routing`. `check`, `add`, `update` and `remove` return promises. |
| `DownloadClientsState` | interface | `{ connections: readonly DownloadConnection[]; defaults: Partial<Record<RoutedDomain, string>>; locked: readonly string[] }`. Connections are in the order added; `defaults` and `locked` hold connection ids. `locked` is not persisted. |
| `DownloadConnection` | interface | `{ id: string; program: DownloadProgram; label: string; url: string; username?: string; hasPassword: boolean; hasApiKey: boolean; routingKey: string }`: what settings hold and show. Never a secret. `id` is random, stable and never sent to an applet; `routingKey` changes whenever `url` does. |
| `DownloadSignIn` | type | `ClientEndpoint` from `@kernlize/bridges`, `{ url, username?, password?, apiKey? }`: what the person types. |
| `CheckedConnection` | interface | `{ signIn: DownloadSignIn; notes: readonly EndpointNote[]; probe: ClientProbe }`: what `check` resolves with. `signIn.url` has its scheme worked out. |
| `DOWNLOAD_PROGRAMS` | `Readonly<Record<DownloadProgram, DownloadProgramInfo>>` | The table above. |
| `ConnectionChange` | interface | `{ label?: string; signIn?: DownloadSignIn }`: what `update` changes; what is left out stays. |
| `ConnectionRouting<T>` | interface | `{ all(): readonly RoutedClient<T>[]; byId(id): RoutedClient<T> \| undefined; preferred(): RoutedClient<T> \| undefined }`, over the connections that can serve now. |
| `RoutedClient<T>` | interface | `{ connection: DownloadConnection; client: T }`. |
| `DownloadProgram` | type | `'transmission' \| 'utorrent' \| 'nzbget' \| 'sabnzbd' \| 'slskd'`. |
| `DownloadDomain`, `RoutedDomain` | types | `'torrent' \| 'nzb' \| 'soulseek'`, and `'torrent' \| 'soulseek'`, the domains where kernl picks the connection. |
| `ClientFor<D>` | type | The client contract a domain's programs speak: `TorrentClient`, `NzbClient` or `SoulseekClient`. |
| `DownloadProgramInfo` | interface | `{ domain: DownloadDomain; name: string; signIn: readonly ('username' \| 'password' \| 'apiKey')[]; example: string }`. |
| `currentPageScheme` | `() => PageScheme` | `'https'` when `location.protocol` is `https:`, otherwise `'http'`, which is also the answer where there is no page. |
| `createTorrentService` | `(options: TorrentServiceOptions) => DownloadService` | The `torrent` service (NAP-TORRENT) over the person's torrent connections. Asks before every add and before data is deleted; a session job is paused in the program when its window ends; persistent jobs are kept at `kernl:torrent-jobs:v1`; calls to the program run one after another. |
| `TorrentServiceOptions` | interface | `DownloadServiceDeps` plus `{ connections: ConnectionRouting<TorrentClient>; pollMs?: number }`. `pollMs` is 2000 by default. |
| `createNzbService` | `(options: NzbServiceOptions) => DownloadService` | The `nzb` service (NAP-NZB) over the person's downloaders. Validates the document before a downloader sees it, asks before every add and every delete, and carries out `add` and `control` once per operation key on a record kept at `kernl:nzb-replay:v1`. |
| `NzbServiceOptions` | interface | `DownloadServiceDeps` plus `{ downloaders: () => readonly NzbDownloader[]; fetchDocument?: (url: string, signal: AbortSignal) => Promise<Uint8Array> }`. Without `fetchDocument` only `bytes` sources are offered. |
| `NzbDownloader` | interface | `{ key: string; label: string; client: NzbClient }`. `createKernl` passes each NZB connection's `routingKey` as `key` and its label as `label`; `key` is never sent to an applet. |
| `readNzbDocument` | `(bytes: Uint8Array) => NzbDocument` | Validates one NZB document with a strict scanner, no XML library: well-formed, within the shell's bounds, root `nzb` in the NZB namespace, at least one file with a segment. An external doctype is read past and never fetched; an internal subset, any entity beyond XML's five and any processing instruction are refused. Throws `invalid:nzb` followed by plain words. |
| `NzbDocument` | interface | `{ files: number; name: string }`: how many files the document lists, and its own title tidied for display. |
| `createSoulseekService` | `(options: SoulseekServiceOptions) => DownloadService` | The `soulseek` service (NAP-SOULSEEK) over the person's Soulseek connections. Asks once per window before it first reaches the network; every handle belongs to the window it was issued to; closing the window or revoking the grant stops its searches and unfinished downloads in the daemon. |
| `SoulseekServiceOptions` | interface | `DownloadServiceDeps` plus `{ connections: ConnectionRouting<SoulseekClient>; limits?: Partial<SoulseekLimits> }`. |
| `SoulseekLimits` | interface | `{ maxQueries, maxTransfers, maxResults, maxPageSize, maxReadBytes, maxTextBytes, queryTimeoutMs, pollIntervalMs }`, reported by `soulseek.info`. |
| `DEFAULT_SOULSEEK_LIMITS` | `SoulseekLimits` | `{ maxQueries: 4, maxTransfers: 16, maxResults: 500, maxPageSize: 100, maxReadBytes: 65536, maxTextBytes: 1024, queryTimeoutMs: 30000, pollIntervalMs: 1000 }`. |
| `SOULSEEK_SESSION_QUESTION` | `DownloadQuestion` | What the person is asked before a window first searches or downloads: who sees what, that nothing is encrypted end to end, and that downloads stop when the window closes. |
| `DownloadService` | interface | `{ handler: ServiceHandler; dispose(): void }`. `dispose` stops every timer and ends every window's work. |
| `DownloadServiceDeps` | interface | `{ appletOf: (windowId) => AppletIdentity \| undefined; ownerOf: (windowId) => string \| undefined; ask: (windowId, question) => Promise<boolean>; storage: StorageLike; now?: () => number }`. `ownerOf` is the key what an applet starts is kept under; the shell passes its catalogue id, so another publisher's applet with the same name is another applet. |
| `DownloadQuestion`, `DownloadQuestionLine` | interfaces | `{ kind: 'add' \| 'session' \| 'delete'; title; lines }` with lines of `{ label, value }`. Words only: no address, path, credential or backend id belongs in a line. |
| `describeDownloadQuestion` | `(question: DownloadQuestion, applet: AppletIdentity, exposesAddress: boolean) => ConsentSummary` | The question as `host.presentConsent` takes it: `destructive` for `delete`, otherwise `direct` when `exposesAddress`, else `routine`. The summary has no `event`. |
| `createKernlDownloads` | `(deps: KernlDownloadsDeps) => KernlDownloads` | The composition `createKernl` uses: the settings always, and the three handlers, the planning extension and their teardown when the domains can be offered. A question from a window that is no longer a live applet is answered no without asking. |
| `KernlDownloadsDeps` | interface | `{ host: Pick<KernlHost, 'storage' \| 'presentConsent' \| 'now'>; options: DownloadsOptions \| undefined; secrets: SecretsProvider; identityOf; fetchDocument }`. |
| `KernlDownloads` | interface | `{ programs: DownloadClients; services: ServiceRegistry; extensions: PlannedExtensions \| undefined; dispose(): void }`. `services` is empty and `extensions` undefined when the domains cannot be offered. |
| `DownloadsOptions` | interface | `KernlOptions.downloads`: `{ pageScheme?: () => PageScheme; fetch?: ClientFetch; offer?: boolean }`. `offer` overrides `supportsDomainBindings()`. |
| `DOWNLOAD_DOMAINS` | `readonly string[]` | `['torrent', 'nzb', 'soulseek']`. |
| `DOWNLOAD_BINDINGS` | `Readonly<Record<string, DomainBinding>>` | The applet-side binding table for the three domains, one row per operation of each draft's wire table, handed to kehto's namespace prelude. |
| `supportsDomainBindings` | `(render?) => boolean` | Whether the installed `@kehto/shell` prelude renders a binding it is given ([kehto/web#413](https://github.com/kehto/web/pull/413)). False on `@kehto/shell` 0.35. |
| `DomainBinding`, `DomainBindingMethod`, `BoundPreludeOptions` | types | `{ methods; events?; handlers? }`, `{ type; params; reply; result? }`, and kehto's prelude options with `bindings`. Declared here until a released `@kehto/shell` exports the shape. |
| `PlannedExtensions` | interface | `{ domains: readonly string[]; bindings: Readonly<Record<string, DomainBinding>> }`: domains kernl serves beyond kehto's list, as `PlanMountOptions.extensions` and `LifecycleContext.extensions` take them. |
| `createStorageSecrets` | `(storage: StorageLike) => SecretsProvider` | The default provider: each secret is one key under `kernl:secrets:v1:`, as typed. `description` is `{ label: 'this device', keeps: 'plain' }`. |
| `createMemorySecrets` | `() => SecretsProvider` | Keeps secrets in memory only. `description` is `{ label: 'this session', keeps: 'session' }`. |
| `SecretsProvider` | interface | `{ description: SecretsDescription; get(name): Promise<string \| undefined>; set(name, value): Promise<void>; delete(name): Promise<void> }`. A method may reject `unavailable:secrets` or `denied:secrets`. `KernlOptions.secrets` takes one. |
| `SecretsDescription` | interface | `{ label: string; keeps: 'plain' \| 'protected' \| 'session' }`. |

### Registries, layouts and persistence

| Export | Signature | Description |
| --- | --- | --- |
| `createDefaultMessaging` | `(options: DefaultMessagingOptions) => MessagingRegistry` | The three providers with persisted preferences; each is available when its backend is supplied and the active account can serve it. `DefaultMessagingOptions.signer` (`() => ISigner \| undefined`) makes `private` and `legacy` availability follow that signer, including for backends a host supplies. |
| `createPrivateMessagesBackend` | `(options: { store: EventStore; pool: ApplesaucePool; tiers: RelayTiers; signer: () => ISigner \| undefined; selfPubkey: () => string \| undefined; now?: () => number }) => MessagingBackend` | NIP-17 messages over the account signer: seal signed by the account with `nip44`, wrap signed by a discarded ephemeral key, sent to inbox relays with the `outbox` and `super` tiers as fallback, plus a copy to self. See [Messaging backends](#messaging-backends). |
| `createLegacyMessagesBackend` | same options `=> MessagingBackend` | NIP-04 kind 4 messages through `signer().nip04`, normalised the same way. Metadata-exposing. |
| `signerAvailability` | `(signer: ISigner \| undefined, method: MessagingEncryption) => ProviderAvailability` | `sign-in-required` with no signer, `signer-cannot-encrypt` when it lacks `method`, otherwise available. |
| `messagingSigner` | `(account: IAccount \| undefined) => ISigner \| undefined` | The signer messaging uses for an account. A read-only account maps to a signer with no encryption, so it reports `signer-cannot-encrypt`. |
| `MessagingEncryption` | `'nip44' \| 'nip04'` | The signer method a backend needs. |
| `SignerMessagingOptions` | `{ store, pool, tiers, signer, selfPubkey, now?, accountChanges? }` | Options for both backends. `accountChanges` clears the in-memory conversations when the account changes or signs out. |
| `MESSAGING_UNAVAILABLE_REASONS` | `Readonly<Record<'signInRequired' \| 'signerCannotEncrypt' \| 'noRuntime', string>>` | `sign-in-required`, `signer-cannot-encrypt`, `no-runtime`. |
| `createDefaultBridges` | `(options?: DefaultBridgesOptions) => BridgeRegistry` | The HTTP bridge, the Blossom bridge over the same web options with `options.blossomServers` as each requester's fallback servers ([D-055](../decisions.md#d-055)), plus torrent, nzb, soulseek and mail. Without `options.handoff` the last four report `no-backend` ([D-010](../decisions.md#d-010)); with it they hand off to an app on the device. `options.torrent` replaces the hand-off for the torrent bridge only ([D-017](../decisions.md#d-017)). `options.http` goes to the HTTP bridge; the rest to the registry. |
| `floatingLayout`, `createDwindleLayout`, `createColumnsLayout`, `createMasterStackLayout` | `LayoutStrategy` and `(options?) => LayoutStrategy` | The layouts above. |
| `createLayoutRegistry`, `createDefaultLayouts` | `(entries?: readonly LayoutEntry[]) => LayoutRegistry`, `(options?: LayoutOptions) => LayoutRegistry` | The layouts a window manager offers. |
| `createWindowManager` | `(options?: WindowManagerOptions) => WindowManager` | kernl's window manager. |
| `installCryptoFallback` | `(scope?: { crypto?: Crypto }) => CryptoFallbackReport` | Adds `crypto.randomUUID` and `crypto.subtle` where the platform withholds them. Also on `@kernlize/core/crypto`. |
| `createFallbackSubtle` | `() => SubtleCrypto` | The pure-JS `SubtleCrypto` described above. |
| `randomUuidFallback` | `(scope: { crypto?: Crypto }) => boolean` | Adds only `crypto.randomUUID`; self-contained, so it can be serialised into a frame. |
| `renderRandomUuidFallbackScript` | `() => string` | The applet-side `<script>` the mount plan inserts. |
| `CryptoFallbackReport` | type | `{ randomUUID, subtle }`: what was added. |
| `createNamespacedStore` | `(storage: StorageLike, prefix: string) => NamespacedStore` | `getJson`, `setJson`, `remove` under `<prefix>:`; corrupt JSON reads as the fallback. |
| `DefaultMessagingOptions`, `DefaultBridgesOptions`, `LayoutOptions`, `MasterStackOptions`, `NamespacedStore` | types | |
| `LayoutChoice`, `LayoutEntry`, `LayoutRegistry`, `ManagedWindow`, `VisibilityTarget`, `WindowManager`, `WindowManagerOptions`, `WindowManagerState`, `WindowSize` | types | The window-management surface. |
| `LayoutStrategy`, `Rect`, `WindowPlacement`, `WindowState` | types | Re-exported from `@kehto/wm`, so a layout can be written against one import. |

### Event cache

| Export | Signature | Description |
| --- | --- | --- |
| `openEventCache` | `(adapters: readonly EventCacheAdapter[], options?: OpenEventCacheOptions) => Promise<EventCache>` | The first adapter that opens, or memory. Also on `@kernlize/core/cache`, like everything in this table. |
| `defaultWebCacheAdapters` | `() => readonly EventCacheAdapter[]` | `[sqlite-opfs, indexeddb, memory]`. |
| `createMemoryCacheAdapter`, `createIndexedDbCacheAdapter`, `createSqliteOpfsCacheAdapter` | `() => EventCacheAdapter`, `(options?: IndexedDbCacheOptions) => EventCacheAdapter`, `(options?: SqliteOpfsOptions) => EventCacheAdapter` | The three web backends. |
| `fromEventDatabase` | `(name: string, database: IAsyncEventDatabase \| IEventDatabase, close?: () => Promise<void> \| void) => EventCache` | Any applesauce event database as a cache. |
| `createEventCache` | `(name: string, records: EventRecords) => EventCache` | The shared rules over a backend's rows. |
| `attachEventCache` | `(store: Pick<IEventStoreStreams, 'insert$'>, cache: EventCache, options?: AttachEventCacheOptions) => AttachedEventCache` | Writes and `cacheRequest` for loaders. |
| `connectEventCache` | `(store, open?: EventCacheOpener) => ConnectedEventCache` | Opens in the background and attaches; `cacheRequest` waits for the open and answers `[]` without a cache; `close()` stops writes and closes. `createKernl` uses it for `options.eventCache`. |
| `isCorruptionError` | `(error: unknown) => boolean` | Whether a sqlite error means a damaged file. |
| `EventCache`, `EventCacheAdapter`, `EventRecords`, `OpenEventCacheOptions`, `IndexedDbCacheOptions`, `SqliteOpfsOptions`, `AttachEventCacheOptions`, `AttachedEventCache`, `CacheRecoveryEvent`, `SqliteDriver`, `SqliteFiles`, `SqlStatement`, `SqlValue`, `LockManagerLike`, `FilenameStorage` | types | |

## Scope

- Composes; does not re-implement a kehto primitive. Local layers exist only where `ShellAdapter` or `createRuntime` has no hook, and each is named in [Alpha status](../alpha-status.md#upstream-gaps).
- Imports events, relays, signing and accounts from applesauce only. `nostr-tools` is a peer dependency, required by kehto and applesauce, and `pnpm check:deps` fails if it is imported.
- Holds no UI. `apps/web` supplies the iframe, the visibility, the prompts and the notices through `KernlHost`.
- Serialises no private key. `PasswordAccount` is the only persisted form of a local key and it is applesauce's.

## API reference

Generated module: [`_kernlize_core`](../api/modules/_kernlize_core.html){target="_self"}
