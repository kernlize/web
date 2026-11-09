# @kernlize/core

Opinionated shell composition over kehto and applesauce. Browser-agnostic: the DOM is reached only through the `KernlHost` hooks and the `FrameLike` shape, so the whole composition runs in vitest against fakes.

| Field | Value |
| --- | --- |
| npm | `@kernlize/core` |
| JSR | `@kernl/core` |
| Version | `0.3.1` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts`; `@kernlize/core/wm` (`@kernl/core/wm` on JSR) is `./dist/wm/index.js`, the layouts and the window manager without the network stack |
| Dependencies | `@internet-privacy/marmot-ts ^0.9.0`; `@kehto/acl ^0.20.3`; `@kehto/firewall ^0.7.0`; `@kehto/nip ^0.8.0`; `@kehto/runtime ^0.28.0`; `@kehto/services ^0.30.1`; `@kehto/shell ^0.32.0`; `@kehto/wm ^0.0.2`; `@kernlize/bridges workspace:^`; `@kernlize/guard workspace:^`; `@kernlize/messaging workspace:^`; `applesauce-accounts ^7.0.2`; `applesauce-common ^7.0.0`; `applesauce-core ^7.0.3`; `applesauce-loaders ^7.0.2`; `applesauce-relay ^7.0.0`; `applesauce-signers ^7.0.1`; `nostr-double-ratchet ^0.0.183`; `rxjs ^7.8.2` |
| Peer dependencies | `@napplet/core >=0.38.0 <0.39.0`; `@napplet/nap >=0.37.0 <0.38.0`; `@napplet/shim >=0.30.0`; `nostr-tools >=2.23.3 <=2.x` |
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

1. **Event layer.** `options.eventStore ?? new EventStore()`, `options.pool ?? new RelayPool()`, `options.accounts ?? createKernlAccounts(host.storage)`. A pool the shell created itself is closed by `destroy()`; a supplied pool is left open.
2. **Relay tiers.** `createRelayTiers(host.storage, options.relays ?? {})`. Persisted choices at `kernl:relays:v1` win over `options.relays`, which only overrides `DEFAULT_RELAY_TIERS` on a fresh device.
3. **Registries.** `options.messaging ?? createDefaultMessaging(...)`, with `createPrivateMessagesBackend` and `createLegacyMessagesBackend` as the `private` and `legacy` backends unless `options.messagingBackends` overrides them, and availability tracking the active account ([Messaging backends](#messaging-backends)), and `options.bridges ?? createDefaultBridges({ handoff: host.openLink, torrent: options.torrent })`, so downloads, sharing and mail hand off through the host's confirm-before-leaving opener and a `KernlOptions.torrent` backend, when given, downloads magnet links inside kernl instead ([D-017](../decisions.md#d-017)). The default bridge registry has no `authorize` hook, so in the composed shell a resource request is checked only by the HTTP bridge's SSRF policy and the applet's `resource` grant.
4. **Guard pipeline.** `createGuardPipeline` with `createGuardConfig(options.guard?.profile ?? 'strict')`, the host's `now` when given, `onEvent` feeding `kernl.guard.events$`, `getVisibility` delegated to `host.getVisibility`, `onQuarantine` marking the handle revoked with reason `quarantine` and calling `bridge.revokeNapplet(windowId, 'host')`, and `onRelease` calling `bridge.releaseDeferred(windowId)` when a window becomes visible.
5. **Services.** `createKernlServices` registers `relay`, `identity`, `theme`, `notify`, `link`, `resource`, `dm` and `outbox` over the pool, the tiers, the event store, the active signer, the consent gate, the host, the bridge registry and the messaging registry. The `outbox` service is wrapped so that `outbox.publish` passes the consent gate first, because kehto's outbox service signs without naming the window. `options.theme` is used only when `isTheme` accepts it. `resolveIdentity` maps a live window to its verified identity so the resource service names the requesting applet to the bridges.
6. **ShellAdapter.** `createShellAdapter` builds kehto's adapter from the relay-pool hooks, the relay-config hooks over the tiers, `createAuthHooks(accounts, consent)`, the service registry, `capabilities.resolveEnvironment` from `createEnvironmentResolver(grants)`, `onNappletRevoked` (removes the frame through the handle, on every reason including `deferred-overflow`), `filterNappletMessage` (answers kehto with `pipeline.observe`: `dispatch`, `defer` or `drop`), `getFocusContext` (`{ focused }` from the pipeline's visibility), `onFirewallEvent` and `firewallPersistence` from `createRuntimeFirewallHooks` (runtime refusals become guard events without the message; the config is kept at `kernl:firewall:v1`), and `aclDefaultPolicy: 'restrictive'` ([D-020](../decisions.md#d-020)). Choices kehto left open are fixed here: applets cannot create windows (`createWindow` returns null), hotkeys are not forwarded, there is no worker relay, update behaviour is `banner`, signatures are verified by applesauce's `verifyEvent`, `link.isAvailable` is true and `getNip66Suggestions` is null.
7. **Bridge.** `createShellBridge(adapter)`, unchanged ([D-001](../decisions.md#d-001)).
8. **Grants.** `createGrants({ acl: bridge.runtime.aclState, storage: host.storage, availableDomains: () => buildShellCapabilities(adapter).domains })`. The ACL is restrictive, so an applet holds only what the grants layer writes, see [Grants](#grants). `pipeline.profile$` is then followed: on boot and on every profile change `applyRuntimeFirewallProfile` sets the runtime's unfocused multiplier and startup burst, and `applyRuntimeFirewallRules` reinstalls the rates of every open window.
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

`plan(summary)` throws `invalid:unresolved` for a summary this shell did not resolve. It calls `grants.ensure(identity)` so the ACL holds the applet's record, numbers the window `applet-1`, `applet-2`, … and returns a `MountPlan`: the environment from kehto's `resolveShellEnvironment` narrowed by the grants, the `srcdoc` with the guard's zero-network CSP and the namespace prelude inserted by `prepareNappletSrcdoc` with kehto's `experimental.nestedContextLock` on (which adds the Trusted Types directives to that CSP), then kernl's insertion lock inserted right after the prelude ([D-014](../decisions.md#d-014)), `sandbox: 'allow-scripts'`, and `missingRequired`, the required domains the environment does not include. The host decides what to do with `missingRequired`; the core mounts whatever it is given.

`mount(plan, frame)` runs in this order:

1. `applyRuntimeFirewallRules(bridge.runtime.firewallState, guard.config, dTag)` installs the profile's rates in kehto's runtime firewall for this applet.
2. Harden the frame: the `sandbox` attribute is set to exactly `allow-scripts`, replacing any tokens the host set; `denyNappletControllerAccess` when the frame has `getAttribute`, otherwise `allow` is set to `CONTROLLER_DENY_POLICY`.
3. `originRegistry.register(window, windowId, { dTag, aggregateHash })`.
4. `originRegistry.setEnvironment(window, plan.environment)`.
5. `bridge.observeFrame(frame, windowId)`, so a second load revokes the binding.
6. Assign `frame.srcdoc = plan.srcdoc`. The handle's status moves from `mounting` to `running` on the frame's first `load`.

A frame without a `contentWindow` throws `invalid:frame-detached`. `handle.close()` calls `bridge.revokeNapplet(windowId, 'host')`, unregisters the window, removes the frame and forgets the window in the guard; a revocation from the bridge (`window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed`, `deferred-overflow`, `host`) removes the frame, forgets the guard state and calls `host.onRevoked`. The frame is never reused. `handle.setVisibility(visibility)` feeds the guard's visibility gate; when the window becomes visible, the requests kehto held for it are released.

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

None of the backends holds key bytes outside a signer or a sealed store; signing, encryption and decryption all go through the account's applesauce signer. The shell's own Messages panel decrypts the user's messages without a kernl prompt, because the request is the shell's, for the user; applets reach messages only through the `dm` domain grant.

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

`BASELINE_DOMAINS` is `['shell', 'inc', 'theme', 'storage']`: every applet gets the handshake, in-shell messaging, the theme and its own scoped storage, which it can read and write, and no network. `identity` is not in the baseline: an applet learns which account is signed in only after the user grants it ("your account" in the shell). `DOMAIN_CAPABILITIES` maps each NAP domain to the kehto capabilities it needs:

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

Unknown domains need no capability (`capabilitiesForDomain('made-up')` is `[]`). `createGrants` keeps a per-identity record `{ dTag, hash, domains, blocked }` at `kernl:grants:v1` and, on every commit, writes it into kehto's ACL, which is restrictive (`aclDefaultPolicy`, [D-020](../decisions.md#d-020)): every capability a baseline or allowed domain needs is granted, whatever the applet's stored entry holds beyond that is revoked, then `block`/`unblock` is applied and the ACL persisted. `KernlGrants.ensure(identity)` does this for an applet that has no record yet; `plan` calls it. `createEnvironmentResolver(grants)` is the `capabilities.resolveEnvironment` hook: each applet sees the baseline plus its allowed domains, intersected with what the shell offers; a blocked applet sees only `shell`. The calls are in [Grant and revoke](../how-tos/grant-and-revoke.md).

### Consent summaries

`describeChange(event, before, applet)` turns a write into a `ConsentSummary` with a `title`, a `severity` and `lines` of `{ label, before?, after? }`:

| Kind | Severity | Title | Lines |
| --- | --- | --- | --- |
| `0` | `destructive` | Update your profile | One line per changed field among name, display name, about, picture, banner, verified address, payment address and website; or "No profile fields change". |
| `3` | `destructive` | Change who you follow | "Follows added" and "Follows removed" with counts and the first three pubkeys abbreviated; or "No entries change". |
| `5` | `destructive` | Delete N item(s), or Delete N post(s) when the `k` tags say every target is kind 1 and no `a` tag is present | One "Delete" line per `e` tag, abbreviated, and one "Delete every version of" line per `a` tag, naming the address in plain words, for example `record (type 30001) "books" by person 3bf0c63f…`. |
| `62` | `destructive` | Ask services to erase your account | "Erase: Everything this account has published" and "Services asked": every service when the `relay` tags are absent or include `ALL_RELAYS`, else the first three named. |
| `10002` | `destructive` | Change your connections list | "Connections added" and "Connections removed" with read/write markers. |
| 10000–10099, 30000–30099 | `destructive` | Change the list "title or d tag", or "Change a list" | "Entries added" and "Entries removed", each entry in plain words: `person 3bf0c63f…`, `item 3bf0c63f…`, `topic …`, `type N`, `server example.com`, `key 3bf0c63f…`, or `name value` for any other tag. |
| any other replaceable (10100–19999) or addressable (30100–39999) kind | `destructive` | Replace one of your records (type N), with the `title` or `d` tag in quotes when there is one | "Entries added" and "Entries removed" over the tags other than `d`, `title` and `description`, and "Content: Replaced" when the content differs, without copying it. |
| anything else | `routine` | Publish a post, repost, reaction, comment, article, sealed message, legacy private message, payment receipt, or "record (type N)" | One "Content" line with a 140-character preview. |

`isDestructiveKind(kind)` is true for exactly the `destructive` rows: every replaceable kind (0, 3, 10000–19999), every addressable kind (30000–39999), 5 and 62.

`LookupBefore` is `(kind, pubkey, identifier?) => Promise<NostrEvent | undefined>`. `lookupReplaceable(store, options?)` builds one: the store answers first; on a miss, and only when `options.loader` is given, the applesauce address loader asks `options.relays()` and the lookup waits at most `options.timeoutMs` (default `CURRENT_VERSION_TIMEOUT_MS`, 4000 ms) and takes the newest version that arrived. A loader that fails or stays silent yields `undefined`. When a replaceable or addressable write is described and no current version was found, the summary's first line is `UNKNOWN_CURRENT_VERSION`, "Current version: could not be loaded; this replaces it entirely", so it never reads as a first version that removes nothing.

`createSigningConsent(options)` returns the `SigningConsent` gate, `(windowId, template) => Promise<void>`: it resolves at once for a routine kind; for a destructive one it builds an unsigned draft (empty `id` and `sig`; this draft is the summary's `event`), describes it against `lookupBefore`, and resolves only when `host.presentConsent` answers yes. It rejects with `denied:consent` when the user refuses, `denied:unknown-applet` for a destructive write from a window the shell did not mount, `denied:signed-out` for a destructive write while nobody is signed in, and `invalid:event-kind` when the kind is not a number.

`createConsentHandler(host, lookupBefore, resolveApplet)` answers kehto's own `ConsentRequest`. The kehto runtime kernl pins raises only `firewall-policy` requests, which carry no event, and the handler refuses those without asking. A request that does carry an event, from a window the shell can name, would be described and put to the user, so a later kehto release that adds such prompts is answered honestly; one from an unknown window is refused.

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

## Exports

Signatures are abbreviated; the generated reference has the full ones.

### Composition

| Export | Signature | Description |
| --- | --- | --- |
| `createKernl` | `(options: KernlOptions) => Kernl` | The composition root described above. |
| `toSession` | `(account: IAccount) => Session` | Describes an account for the UI; `readOnly` when it cannot sign. |
| `createAppletLifecycle` | `(context: LifecycleContext) => AppletLifecycle` | `resolve`, `plan`, `mount`, `applets`, `handleWindowMessage` over the composed parts. |
| `resolveWindow` | `(handles: ReadonlyMap<string, MountedApplet>, event: MessageEvent) => WindowResolution \| null` | The sending window from `originRegistry`, never from the message. |
| `createShellAdapter` | `(deps: ShellAdapterDeps) => ShellAdapter` | kehto's adapter from kernl's parts, with the fixed choices listed under Composition. `deps.consent` (a `SigningConsent`), `deps.filterNappletMessage`, `deps.getFocusContext` and `deps.runtimeFirewall` are required; the adapter always sets `aclDefaultPolicy: 'restrictive'`. |
| `createKernlServices` | `(deps: KernlServiceDeps) => KernlServices` | `{ registry, theme, dm }` with kehto's eight reference services wired. `deps.consent` is required; `outbox.publish` passes it before signing, and a refusal is answered as `outbox.publish.result` with `ok: false` and the reason. |
| `isTheme` | `(value: Record<string, unknown> \| undefined) => value is Theme` | True when `colors.background`, `colors.text` and `colors.primary` are strings. |
| `resourceInitFor` | `(deps, init: ResourceFetchInit) => ResourceResolveInit` | Names the requesting applet, or `'shell'`, to the bridge resolver. |
| `LINK_PROTOCOLS` | `readonly string[]` | `['https:', 'mailto:']`. |
| `PACKAGE_NAME` | `'@kernlize/core'` | |
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
| `planMount` | `(options: PlanMountOptions) => MountPlan` | Environment, CSP-prepared `srcdoc` with kehto's nested-context lock and kernl's insertion lock, `missingRequired`. No DOM. Throws `denied:nested-frame` when kehto's `assertNappletHasNoFrame` finds a frame in the verified markup, and `unavailable:frame-lock` when kehto's CSP meta and prelude are not where it expects them ([D-014](../decisions.md#d-014)). |
| `mountApplet` | `(plan: MountPlan, frame: FrameLike, deps: MountDeps) => MountedApplet` | The NIP-5D mount order; throws `invalid:frame-detached`. Calls `frame.setAttribute('sandbox', 'allow-scripts')`. |
| `CONTROLLER_DENY_POLICY` | `string` | `gamepad 'none'; hid 'none'; usb 'none'`. |
| `BLOB_TIMEOUT_MS` | `20_000` | |
| `AppletPointer`, `AppletSummary`, `AppletIdentity`, `MountPlan`, `AppletHandle`, `AppletStatus`, `FrameLike`, `ResolveAppletOptions`, `ResolvedApplet`, `PlanMountOptions`, `MountDeps`, `MountGuardHooks`, `MountedApplet` | types | `MountedApplet` adds `revoked(reason)` to `AppletHandle` for the bridge's revocation hook. `FrameLike.sandbox` is optional and not read: the mount replaces the attribute whatever it held. |

### Guard

| Export | Signature | Description |
| --- | --- | --- |
| `createGuardPipeline` | `(options: GuardPipelineOptions) => GuardPipeline` | Ingress guard, visibility gate and focus firewall in front of the bridge; `handleWindowMessage` for window-level messages, `observe` for port traffic, which returns kehto's `NappletMessageDecision` (`dispatch`, `defer` for a hidden window's non-control envelope, `drop` for what the guard will not let through). `onRelease(windowId)` is called when a window becomes visible. |
| `runtimeFirewallRules` | `(config: GuardConfig, napplet: string) => RuntimeFirewallRules` | The profile's per-class rates translated to the runtime's capability keys, plus the global rate. |
| `applyRuntimeFirewallRules` | `(firewallState: RuntimeFirewallState, config: GuardConfig, napplet: string) => void` | Installs those rules in `bridge.runtime.firewallState` and persists. Sets no policy: kehto's `allow` policy would skip every rate, matcher and burst check. |
| `applyRuntimeFirewallProfile` | `(firewallState: RuntimeFirewallState, config: GuardConfig) => void` | Sets the profile's `unfocusedMultiplier` and `burstGuard` on the runtime firewall and persists. |
| `createRuntimeFirewallHooks` | `(options: RuntimeFirewallHooksOptions) => RuntimeFirewallHooks` | `firewallPersistence` over the host storage at `RUNTIME_FIREWALL_STORAGE_KEY` and `onFirewallEvent` feeding `options.onEvent` through `toGuardEvent`. |
| `toGuardEvent` | `(event: FirewallEvent, at: number) => GuardEvent` | A runtime firewall event in the guard's words (`rate:<class>`, `flood:startup`, `runtime:<ruleId>`), without the applet's message. |
| `RUNTIME_FIREWALL_STORAGE_KEY` | `'kernl:firewall:v1'` | Where the runtime firewall's configuration is kept. |
| `RUNTIME_OP_CLASSES` | `Readonly<Record<OpClass, string \| null>>` | Guard class to runtime key; `null` for `relay:publish:delete`, `control` and `generic`. See [Guard](../concepts/guard.md#where-enforcement-happens). |
| `GuardPipeline`, `GuardPipelineOptions`, `PipelineDisposition`, `WindowResolution`, `RuntimeFirewallRules`, `RuntimeRateRule`, `RuntimeFirewallState`, `RuntimeFirewallHooks`, `RuntimeFirewallHooksOptions` | types | `PipelineDisposition` is `GuardDisposition \| 'unrouted'`, the answer for window-level messages. Every use of the runtime firewall's own configuration is in this one module, `guard/runtime-rules.ts`, because [kehto/web#336](https://github.com/kehto/web/pull/336) replaces it ([D-020](../decisions.md#d-020)). |

### Grants and consent

| Export | Signature | Description |
| --- | --- | --- |
| `createGrants` | `(options: GrantsOptions) => KernlGrants` | The grants surface over `bridge.runtime.aclState`, persisted at `kernl:grants:v1`. |
| `createEnvironmentResolver` | `(grants: Grants) => CapabilityHooks['resolveEnvironment']` | Baseline plus allowed domains; `shell` only when blocked. |
| `BASELINE_DOMAINS` | `readonly string[]` | `['shell', 'inc', 'theme', 'storage']`. |
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
| `createDefaultMessaging` | `(options: DefaultMessagingOptions) => MessagingRegistry` | The three providers with persisted preferences; each is available when its backend is supplied and the active account can serve it. `DefaultMessagingOptions.signer` (`() => ISigner \| undefined`) makes `private` and `legacy` availability follow that signer, including for backends a host supplies. |
| `createPrivateMessagesBackend` | `(options: { store: EventStore; pool: ApplesaucePool; tiers: RelayTiers; signer: () => ISigner \| undefined; selfPubkey: () => string \| undefined; now?: () => number }) => MessagingBackend` | NIP-17 messages over the account signer: seal signed by the account with `nip44`, wrap signed by a discarded ephemeral key, sent to inbox relays with the `outbox` and `super` tiers as fallback, plus a copy to self. See [Messaging backends](#messaging-backends). |
| `createLegacyMessagesBackend` | same options `=> MessagingBackend` | NIP-04 kind 4 messages through `signer().nip04`, normalised the same way. Metadata-exposing. |
| `signerAvailability` | `(signer: ISigner \| undefined, method: MessagingEncryption) => ProviderAvailability` | `sign-in-required` with no signer, `signer-cannot-encrypt` when it lacks `method`, otherwise available. |
| `messagingSigner` | `(account: IAccount \| undefined) => ISigner \| undefined` | The signer messaging uses for an account. A read-only account maps to a signer with no encryption, so it reports `signer-cannot-encrypt`. |
| `MessagingEncryption` | `'nip44' \| 'nip04'` | The signer method a backend needs. |
| `SignerMessagingOptions` | `{ store, pool, tiers, signer, selfPubkey, now?, accountChanges? }` | Options for both backends. `accountChanges` clears the in-memory conversations when the account changes or signs out. |
| `MESSAGING_UNAVAILABLE_REASONS` | `Readonly<Record<'signInRequired' \| 'signerCannotEncrypt' \| 'noRuntime', string>>` | `sign-in-required`, `signer-cannot-encrypt`, `no-runtime`. |
| `createDefaultBridges` | `(options?: DefaultBridgesOptions) => BridgeRegistry` | The HTTP bridge plus torrent, nzb, soulseek and mail. Without `options.handoff` the last four report `no-backend` ([D-010](../decisions.md#d-010)); with it they hand off to an app on the device. `options.torrent` replaces the hand-off for the torrent bridge only ([D-017](../decisions.md#d-017)). `options.http` goes to the HTTP bridge; the rest to the registry. |
| `floatingLayout`, `createDwindleLayout`, `createColumnsLayout`, `createMasterStackLayout` | `LayoutStrategy` and `(options?) => LayoutStrategy` | The layouts above. |
| `createLayoutRegistry`, `createDefaultLayouts` | `(entries?: readonly LayoutEntry[]) => LayoutRegistry`, `(options?: LayoutOptions) => LayoutRegistry` | The layouts a window manager offers. |
| `createWindowManager` | `(options?: WindowManagerOptions) => WindowManager` | kernl's window manager. |
| `createNamespacedStore` | `(storage: StorageLike, prefix: string) => NamespacedStore` | `getJson`, `setJson`, `remove` under `<prefix>:`; corrupt JSON reads as the fallback. |
| `DefaultMessagingOptions`, `DefaultBridgesOptions`, `LayoutOptions`, `MasterStackOptions`, `NamespacedStore` | types | |
| `LayoutChoice`, `LayoutEntry`, `LayoutRegistry`, `ManagedWindow`, `VisibilityTarget`, `WindowManager`, `WindowManagerOptions`, `WindowManagerState`, `WindowSize` | types | The window-management surface. |
| `LayoutStrategy`, `Rect`, `WindowPlacement`, `WindowState` | types | Re-exported from `@kehto/wm`, so a layout can be written against one import. |

## Scope

- Composes; does not re-implement a kehto primitive. Local layers exist only where `ShellAdapter` or `createRuntime` has no hook, and each is named in [Alpha status](../alpha-status.md#upstream-gaps).
- Imports events, relays, signing and accounts from applesauce only. `nostr-tools` is a peer dependency, required by kehto and applesauce, and `pnpm check:deps` fails if it is imported.
- Holds no UI. `apps/web` supplies the iframe, the visibility, the prompts and the notices through `KernlHost`.
- Serialises no private key. `PasswordAccount` is the only persisted form of a local key and it is applesauce's.

## API reference

Generated module: [`_kernlize_core`](../api/modules/_kernlize_core.html){target="_self"}
