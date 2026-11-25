# @kernlize/core

## 0.30.0

### Minor Changes

- c6402c7: `@kernlize/core` is deprecated (D-068). `createKernl`, `kernlModules` and the `Kernl` types move into `@kernlize/preset`, which is now public, and core re-exports the kernel, the modules and the preset, so every name it exported is still there. Import from `@kernlize/kernel`, `@kernlize/modules` and `@kernlize/preset` instead; core goes one minor from now.

## 0.29.3

### Patch Changes

- 8ddbc32: kernl's modules move into their own package, `@kernlize/modules` (D-068), and `@kernlize/core` re-exports it, so every name core exported is still there. `@kernlize/core/wm`, `@kernlize/core/cache`, `@kernlize/core/messaging/ratchet` and `@kernlize/core/messaging/groups` re-export the modules' entries of the same names.

## 0.29.2

### Patch Changes

- 7bf6b0b: Replay cached public tree events on approved Outbox subscriptions before opening the live relay read. One-shot Outbox queries merge cached events into the normal relay response. The cache module enables this without changes to applets or the Outbox API.
- Updated dependencies [7bf6b0b]
  - @kernlize/kernel@0.1.1

## 0.29.1

### Patch Changes

- 215c376: The kernel moves into its own package, `@kernlize/kernel` (D-068), and `@kernlize/core` re-exports it, so every name core exported is still there. `@kernlize/core/crypto`, `@kernlize/core/seal` and `@kernlize/core/asks` re-export the kernel's entries of the same names. `asFilters` and `bindingMethod` are now exported too.

## 0.29.0

### Minor Changes

- 9478570: `Kernel` is now the kernel's own interface, and `Kernl` is `Kernel & KernlMembers`, where `KernlMembers` lists the members kernl's own modules provide and `ModuleMembers` is its keys. `Kernl` is a type alias now, not an interface, so it can no longer be extended with `interface … extends Kernl` merging; extend `Kernel` or intersect instead. `KernlOptions` is likewise `KernelBaseOptions & KernlModuleOptions & { modules? }`: `KernelBaseOptions` holds what the kernel takes, `KernlModuleOptions` what only kernl's own modules read (`KernlModuleOptionKeys` is its keys), and `KernelOptions` is `KernelBaseOptions` with `modules` required.

## 0.28.0

### Minor Changes

- cbc86fd: Groundwork for the package split (#75); every public name keeps its export.

  - The ask facts (`DownloadQuestion`, `DownloadQuestionLine`, `UploadDetails`) live with the ask contract.
  - The domain binding types, `supportsDomainBindings` and the new `bindingMethod` live with the applet lifecycle.
  - The guard's key handling lives in the guard, and `ShortcutKey` with the host contract.
  - `createKernlServices` no longer builds a `keys` service; the keys module answers `keys`. `KernlServiceDeps` loses `keys`, its `shortcuts` is now only `{ isFocused }`, and `KernlServices` loses `keys`.
  - `createKernlServices` no longer wires `cvm`; the multiplayer module answers it. `KernlServiceDeps` loses `remoteTools` and `identities`.

## 0.27.0

### Minor Changes

- 87dfd5b: `@kernlize/core/asks` is a new entry: `ASK_KINDS`, `ASK_REFUSALS`, `createAskChannel`, `toAskChannel` and the ask types, without the network stack, so a UI's ask queues load before the core.
- f2996c2: `@kernlize/core/seal` is a new entry: the message seal (`MESSAGES_DOMAIN`, `MESSAGE_COMPANION_DOMAINS`, `sealsApplet`, `domainsInForce`, `withheldDomains`, `capabilitiesInForce`) and the domain capabilities (`BASELINE_DOMAINS`, `DOMAIN_CAPABILITIES`, `capabilitiesForDomain`, `capabilitiesForDomains`), without the network stack. `@kernlize/ui-model` reads the seal through it, so a host that draws the grants list bundles no third-party code.

## 0.26.0

### Minor Changes

- e8c9ce0: Typed asks (D-067). `KernlHost.asks` takes one renderer per kind of question the kernel puts to the person: `sign.replace`, `upload.file`, `download.add`, `connection.direct`, `firewall.approve`, `intent.choose-handler`, `messaging.choose-reply` and `settings.present`. Each `Ask` carries its facts and kernl's own words (`defaultText`). A kind nobody draws, a renderer that fails, and an answer for a window that has closed or runs another applet get the kind's refusal, never an allow; only the firewall's question is timed out. `presentConsent`, `presentApproval`, `chooseHandler`, `chooseReply` and `presentSettings` still draw the kinds they used to and are deprecated; `presentConsent` is now optional. `createAskChannel`, `toAskChannel`, `ASK_KINDS` and `ASK_REFUSALS` are exported. Breaking for module authors: `KernelContext.ask(summary)` is now `ask(ask)`, for the kinds a module lists in `KernlModule.asks`, and rejects `invalid:ask-undeclared:<kind>` otherwise; `KernelContext.host` loses the prompt callbacks, and `canAsk(kind)` is new. `createSigningConsent`, `createConsentHandler`, `askUploadConsent` (which gains `windowId`) and `createFirewallPermissions` (which gains `asks`) take a host or an ask channel. `createKernlDownloads` takes `ask`, and `createKernlIntents` takes `choose`. `createDirectConnectionsService`'s `ask` receives the ask. `settingsModule()` without a form draws through the host's `settings.present` renderer, and `createKernl` no longer forwards `presentSettings` itself.

## 0.25.0

### Minor Changes

- c4e6666: Messaging is a module, `messagingModule({ providers })`, in `kernlModules()`, exposed as `kernl.messaging`, over `privateDm()`, `legacyDm()`, `ratchet()` and `groups()`; without it `dm` is not offered. Each provider takes its own `backend`, which replaces `KernlOptions.messagingBackends` (removed). A registry the host built goes in as `messagingModule({ registry })`, or still as `KernlOptions.messaging` when the host names no modules, and is left open when the shell closes. `createKernel` composes the kernel with the named modules only, and `@kernlize/core/kernel` exports everything but kernl's own module list, so a host that lists only `privateDm()` bundles neither the ratchet nor the group library; `ratchet()` and `groups()` are also on `@kernlize/core/messaging/ratchet` and `@kernlize/core/messaging/groups` (D-066). `dm` leaves `KERNEL_DOMAINS`; `ModuleMembers` gains `messaging`; `KernelContext.host` gains `chooseReply`, and `KernelContext.signer()` returns the active account, which queues requests. `createKernlServices` no longer registers `dm` or `common`: `KernlServiceDeps` loses `messaging`, `profiles`, `people` and `common`, and `KernlServices` loses `dm`. `createProviderMessaging` builds a registry over the providers given.
- 353de2f: Remote tools and direct connections are a module, `multiplayerModule({ remoteTools, directConnections })`, in `kernlModules()`, exposed as `kernl.multiplayer`. Without it `cvm` and `webrtc` are not offered. `KernelContext` gains `holds(windowId, domain)`. `createKernlServices` no longer wires `webrtc` or reads the person's multiplayer settings, and `KernlServiceDeps` loses `directConnections` and `multiplayer`; `remoteTools: null` leaves `cvm` to the module. `DirectConnectionsDeps` is removed.

## 0.24.0

### Minor Changes

- 4c89c22: The download programs and the `torrent`, `nzb` and `soulseek` domains are a module, `downloadsModule(options)`, in `kernlModules({ downloads })`, exposed as `kernl.downloads`. It requires the bridges module and signs in through `KernelContext.secrets`, the kernel's secrets provider. `ModuleInstance.rendersBindings` lets a module say the host's own prelude renders its bindings.

## 0.23.0

### Minor Changes

- 52bf0eb: The bridges are a module, `bridgesModule({ registry, torrent })`, in `kernlModules({ bridges, torrent })`, exposed as `kernl.bridges`. The kernel's `resource` service and downloads resolve through it; without it `resource` is not offered. `KernlOptions.bridges` and `KernlOptions.torrent` still reach it when a host names no modules. `KernlServiceDeps.bridges` is optional.
- 136b5a9: Applets handing work to each other, the `intent` domain, are a module, `intentsModule()`, in `kernlModules({ intentRetry })`, exposed as `kernl.intents`. Without it `intent` is not offered and `kernl.install` refuses with `unavailable:intents`. `Intents` gains `record(summary)`. `KernelContext` gains `applets()` and `host`. `KernlIntentDeps` takes the signed-in `identity` instead of the account manager.
- cfdfbf7: Applets' keyboard shortcuts, the `keys` domain, are a module, `keysModule(settings)`, in `kernlModules({ shortcuts })`. Without it `keys` is not offered and leaves the baseline every applet starts with. `KernelContext` gains `isFocused(windowId)`. `KernlServiceDeps.keys: null` leaves the domain to the module, and `KernlServices.keys` may be undefined.

## 0.22.0

### Minor Changes

- 4b80aa7: The applet store's catalogue is a module, `catalogModule()`, in `kernlModules()`, exposed as `kernl.catalog`. Without it the shell has no store; an applet still opens from its address.
- d085002: Applets' settings, the `config` domain, are a module, `settingsModule(present)`, in `kernlModules({ presentSettings })`. With no module list, `createKernl` hands it the host's `presentSettings`; a host that names its modules passes the form itself. Without a form, or without the module, `config` is not offered.

## 0.21.0

### Minor Changes

- 294c656: The file servers and the `upload` domain are a module, `filesModule()`, in `kernlModules()`, exposed as `kernl.files`. Without it `upload` is not offered. `KernelContext` gains `ask(summary)`, a question put to the person through the host's consent prompt. `KernlNetwork` holds only the replaceable loader, and `KernlNetworkParts` has no `destroyed$`.

## 0.20.0

### Minor Changes

- 7ea0322: The mailboxes are a module, `mailboxesModule()`, in `kernlModules()`. It sets the `outbox` tier from the identity's relay list and signs its save with the active signer; without it the `outbox` tier stays as set. `KernelContext` gains `signer()`, for writes the host starts for the person (D-065), and `find(id)`. `KernlNetwork` has no `mailboxes`, and `KernlNetworkParts` no `directory`.

## 0.19.0

### Minor Changes

- 4c3b0d3: The theme module publishes a change to the applets that are open. `themeModule` now returns an api, `ThemeApi` (`kernl.theme.publish(theme)`): it sends `theme.changed` to every applet holding `theme:read` and answers the next `theme.get` with the same palette, so a shell that follows the person's colour scheme keeps the applets matching it (D-064).

## 0.18.0

### Minor Changes

- 7cdcbad: The event cache is a module, `cacheModule(open)`, in `kernlModules({ eventCache })`; `KernlOptions.eventCache` still reaches it when a host names no modules. Without the module the shell keeps events in memory only. `createKernlNetwork` takes only its parts, with an optional `cacheRequest`, and `KernlNetwork` has no `eventCache`.
- fdee100: The relay directory is a module, `directoryModule()`, in `kernlModules()`. A host that names its own modules gets `Kernel & ModuleApis<M>`: `kernl.directory` is there only when the directory module is loaded. Without it, an account with no relay list is offered the well-known servers. `createKernlNetwork` no longer builds the directory; it takes a `directory` accessor for the mailboxes' suggestions instead, and `KernlNetwork` has no `directory`.
- 82ede62: Profiles and people are modules, `profilesModule()` and `peopleModule()`, in `kernlModules()` before the social module, which requires them. Without the profiles module the session is labelled by the start of its key; without the people module an applet's recipients are taken as hex keys only. `KernelContext` gains `replaceableLoader`; `KERNEL_PARTS` and `checkModules`' second parameter are gone, and `KernlNetwork` has no `profiles` or `people`.

## 0.17.0

### Minor Changes

- 9f957d9: The `media` domain: `kernl.media` lists what applets play and plays a source for them under six settings the person chooses (one at a time or several, pause or end the earlier, videos in a window or in the player, hidden windows, starting on its own, and whether what the shell plays keeps playing, pauses or stops when its applet closes). `createKernlServices` registers it and now needs `host.storage`.

  The guard no longer holds back an applet's reports on a media session while its window is hidden; making a session still waits until it is shown.

### Patch Changes

- Updated dependencies [9f957d9]
  - @kernlize/guard@0.3.1

## 0.16.0

### Minor Changes

- 5b02e58: A module host: `createKernl({ host, modules })` composes the shell from `KernlModule`s, checked before anything is built and disposed last loaded first, with each module's api typed as `kernl[id]`. The `theme` and `common` domains are now the theme and social modules; `kernlModules()` is what a shell loads when it names none, so existing callers are unchanged. A shell without the theme module does not offer `theme` and leaves it out of the baseline. `createCommonActions` also takes a consented `sign`, and `loadReplaceableQuietly` is exported.

## 0.15.0

### Minor Changes

- 0c6c9d5: Grants made for now, and an exception to the message seal the person can make. `Grants.allowDomain` takes `{ unsafe, remember }` and `revokeDomain` takes `{ remember }`; `Grants.forgetTemporary(identity)` drops what was granted for now, and kernl calls it when an applet's last window ends. `GrantRecord` gains `unsafe` (domains the person kept beside messages, which stay in force; `intent:write` stays withheld) and `temporary`. `domainsInForce`, `withheldDomains` and `capabilitiesInForce` take the kept domains. `AppletAdmissions` gains `isWaiting`. A custom `Grants` implementation must add `forgetTemporary` and the two record fields.

## 0.14.0

### Minor Changes

- 27e3047: `kernl.traffic$` reports every message between the shell's applets and itself, both ways, on the window and on the port, with `error` set when a message reports a failure. New exports: `appletMessageFailure`, `describeAppletMessage`, `createAppletTraffic` and the `AppletMessage` types.
- b8e06ee: `KernlHost.onRevoked` takes a third argument, `AppletStopDetails`, so a host can say why an applet stopped without guessing from the reason code. It carries kehto's own `detail` line for a bridge revocation and, for a quarantine, the `limit` crossed: `flood` with its count and window, or `hidden-resource` with its allowance, each with the guard profile in force. The guard pipeline's `onQuarantine` now receives the guard's reason as well.
- 0ee9182: `WindowManager.replace(id, next)`: a window whose applet starts again under a new id keeps its rectangle, its place in the opening order and in any arrangement, is shown, is no longer stopped, and comes to the front, focused. Its old target is reported to no more. A custom `WindowManager` must implement it.

  An applet handle that was closed or stopped no longer passes visibility reports to the guard, so a late report cannot bring back guard state for a window that is gone.

## 0.13.0

### Minor Changes

- 9488528: Applets' `blossom:` resources load. `createBlossomBridge` and `parseBlossomReference` are new in `@kernlize/bridges`: the bridge reads BUD-10 references and the `blossom:sha256:<hash>` form, asks the reference's hints and then the requester's servers under the web policy, and returns only bytes whose hash matches. `createDefaultBridges` registers it, with `blossomServers` for each requester's servers, and `createKernl` passes the running applet's manifest servers. Resource failures now reach applets as their NAP-RESOURCE codes (`not-found`, `unsupported-scheme`, `blocked-by-policy`, …) through the new `resourceErrorFor`, instead of all as `network-error`.
- 06c02fc: The `torrent`, `nzb` and `soulseek` domains over programs the person runs, through which an applet can add torrents and NZBs, follow and control their jobs, read a torrent's metadata and change its limits and sharing, and search and browse shared libraries: `createTorrentService`, `createNzbService`, `createSoulseekService`, `createDownloadClients` (`kernl.downloads`) and `createKernlDownloads`. A person may keep any number of connections, several to one program among them (`DownloadConnection`, with a random `id` and a `label`): `check`, `add`, `update`, `remove`, `chooseDefault` and `routing`. kernl sends a new torrent to the connection that already holds it, else the domain's default, sends searches to the default, and keeps each job and query on its connection; NZB applets choose among connections by label. Secrets are kept under `download:<connection id>:password` and `…:apiKey`. New reasons `invalid:label` and `invalid:connection`. The domains are offered only when the installed `@kehto/shell` prelude renders a binding table (`supportsDomainBindings`), or `KernlOptions.downloads.offer` says the host's own does. Passwords and keys go to a `SecretsProvider` the host can replace through `KernlOptions.secrets`; `createStorageSecrets` is the default and `createMemorySecrets` keeps them for the session only.

  **Breaking.** `ConsentSummary.event` is optional: a download question is not about an event, so a `presentConsent` implementation must not assume one. `Kernl` gains the required members `downloads` and `secrets`, so anything that implements the interface itself must supply both.

- 4d19b2a: kehto's firewall is now an approval authority and its temporal engine moved to `@kehto/rate-limit`; kernl adopts both (D-056).

  `@kernlize/guard`: `createFocusFirewall` is `createFocusRateLimiter`, over `@kehto/rate-limit`'s `evaluateRateLimit` with one budget per operation class in `GuardConfig.rateLimits`. `applyNappletRules`, `GuardConfig.firewall` and the legacy engine are gone. A `firewall` mitigation is described.

  `@kernlize/core`: the shell configures kehto's `permissions`. Every applet is admitted by the firewall in `plan`, and every request is put to it. `defaultFirewallRules` allows what the person granted and asks about every link. `Kernl.firewall` sets rules and takes answers back; `KernlHost.presentApproval` shows a question; `KernlHost.openLink` is told when a link was already approved. `createRuntimeRateLimiter` replaces the legacy rate gate, and the `runtime-rules` exports are removed.

- 6bc9b41: Keyboard shortcuts work for every applet. `keys` is now a baseline domain served by `createShortcutsService`: an applet gets the key it asks for, is told its bindings, and has its action run in the focused window. A keymap registered as an applet starts is held through the startup window instead of being refused, a held key's repeats no longer count as a flood, and the guard classifies `keys.*` as `control`. `createKernlServices` requires `shortcuts`, `KernlOptions.shortcuts` reserves the host's own chords, and `KernlHost.onShortcut` receives the keys an applet forwards.

### Patch Changes

- 63b2cc0: A relay is called a relay and shown by its own host. Consent summaries say `relay relay.damus.io` where they said `server damus.io`, `Inbox relays added` and `Outbox relays added` for a changed inbox and outbox, and `Relays asked` in a request to erase an identity. `describeOutcome` says `Saved to 2 of 3 relays`, `No relay accepted it` and `There was no relay to save it to`.
- Updated dependencies [9488528]
- Updated dependencies [06c02fc]
- Updated dependencies [4d19b2a]
- Updated dependencies [6bc9b41]
  - @kernlize/bridges@0.3.0
  - @kernlize/guard@0.3.0

## 0.12.0

### Minor Changes

- 98f7a27: Seal applets that hold the `dm` grant: only the domains that cannot send a message elsewhere stay in force (`MESSAGE_COMPANION_DOMAINS`), and the rest are withheld from the ACL and the environment. `GrantRecord` gains `withheld`. Adds `domainsInForce`, `withheldDomains`, `capabilitiesInForce` and `sealsApplet`.
- 33db31a: Find a person from any form of their identity: `parsePerson`, `createPeople` (`kernl.people`) and `locateRecipients` read hex, `npub` and `nprofile`, and ask the servers an `nprofile` names. `CommonActionsOptions` gains a required `locate`.
- df260b8: Add `createThrowawayIdentity`, an identity for trying the shell whose key is held in memory and never persisted.

### Patch Changes

- 0f8efb1: Say "identity" instead of "account" in the consent summaries and mitigation descriptions people read.
- Updated dependencies [0f8efb1]
  - @kernlize/guard@0.2.1

## 0.11.0

### Minor Changes

- 798e9b0: Applets can open direct sessions between people. Where the page has `RTCPeerConnection`, `createKernl` registers the `webrtc` service as `createDirectConnectionsService`: kehto's service over `createDirectSignaling`, which speaks Paja's `soy-rtc/1` signaling under each window's own key, never the account. A session opens only for an applet granted direct connections, and only after the person allows it in a prompt that says what the other side learns; `ConsentSummary.severity` gains `direct` (D-042). `KernlOptions.directConnections` names the relays that introduce people (the `super` tier by default), STUN and TURN servers (none by default) and a peer factory. New exports: `createDirectConnectionsService`, `createDirectSignaling`, `describeDirectConnection`, `directNamespace`, `DIRECT_SIGNALING_PROFILE`, `DIRECT_SIGNAL_KIND`, `DIRECT_MAX_PAYLOAD_BYTES`, and their option types.
- b5fe9fa: The person chooses, on their device, the servers that introduce them and find tool servers, the helpers that get their connections through, and the tool families they trust. `kernl.multiplayer` (`createMultiplayerSettings`, kept at `kernl:multiplayer:v1`) holds them, and each comes before the host's. `kernl.multiplayer.discover(input)` finds families from a shared reference, a tool's schema hash or a website, reading only signed announcements and checking every tool's hash again (D-043). `RemoteToolsOptions.registry` and `DirectConnectionsOptions.iceServers` are now read through functions. New exports: `createMultiplayerSettings`, `validFamily`, `discoverToolFamilies`, `TOOL_DISCOVERY_TIMEOUT_MS`, `mergeFamilies`, and their types.
- 70cb90d: Applets can call remote tools. `createKernl` registers the `cvm` service as `createRemoteToolsService`: each window calls under its own key from `createWindowIdentities`, never the account's, through its own transport over the shell's pool, and the key is wiped when the window ends (D-041). `KernlOptions.remoteTools` names the relays tool servers are looked for on (the `super` tier by default) and the tool families the host vouches for. New exports: `createRemoteToolsService`, `createCvmRelayPool`, `createWindowIdentities`, `RemoteToolsOptions`, `RemoteToolsSettings`, `WindowIdentities`.

## 0.10.0

### Minor Changes

- 3315271: Applets can have settings (NAP-CONFIG). `createAppletConfig` keeps each applet's values by catalogue id, so an update keeps them, and opens the host's settings form through the new optional `KernlHost.presentSettings`. The shell offers the `config` domain only when the host provides that form.
- 4fa61e5: Move to `@kehto/shell` 0.35, `@kehto/services` 0.34, `@kehto/runtime` 0.30, `@kehto/acl` 0.20.6, `@napplet/core` 0.41, `@napplet/nap` 0.40 and applesauce 7.1 (D-037).

  - **core:** `createRuntimeFirewallHooks` now constructs the runtime firewall from `@kehto/rate-limit/legacy` and returns it as `legacyFirewall` in place of `firewallPersistence`, because the runtime no longer builds one. The stored configuration under `kernl:firewall:v1` keeps its format. New `createAppletRelayService` plans relay publishes by event kind for kehto's planned relay contract. Signers are kept stable per account and window so the identity and relay services deliver their replies. Intents are delivered through the runtime's recipient gate. The shell's pool is built with the new `SHELL_RELAY_OPTIONS`, one redial after a second for publishes and requests, because applesauce-relay 7.1 otherwise holds a publish to a dead relay for about six seconds. A manifest lookup lets applesauce-relay redial a refused relay once instead of repeating the round. The `@napplet/core` peer range is now `>=0.41.0 <0.42.0` and `@napplet/nap` `>=0.37.0 <0.41.0`.
  - **guard:** the temporal engine moved from `@kehto/firewall` to `@kehto/rate-limit/legacy`; the guard depends on `@kehto/rate-limit` and its `GuardConfig.firewall` and `FocusFirewall.observe` types come from there. The `@napplet/core` peer range widens to `<0.42.0`.
  - **messaging:** the `@napplet/core` peer range widens to `<0.42.0`.

- 1f689aa: `fetchManifestEvent`, and so `Kernl.resolve`, now throws `unavailable:unreachable` when no relay opened a connection, and keeps `unavailable:network` for relays that connected and did not answer in time (D-039). An empty answer from relays that never connected no longer reads as `unavailable:manifest`. Hosts matching only `unavailable:network` should also match the new reason.
- 5b5e74f: Narrowing a running applet's grant now stops its window (D-038). When a domain the window was started with is taken back, or the applet is blocked, the frame is removed, kehto's binding is revoked, and `host.onRevoked` hears `grant-narrowed` or `blocked`. Granting more stops nothing. New export `grantNarrowingReason`.

### Patch Changes

- Updated dependencies [4fa61e5]
  - @kernlize/guard@0.2.0
  - @kernlize/messaging@0.4.1

## 0.9.0

### Minor Changes

- 2dd8af2: Applets can take social actions (NAP-COMMON). `createCommonActions` reads profiles and follows, and follows, unfollows, reacts and reports on the person's behalf. A follow-list change passes the signing gate, so the person sees who is added and removed first. The shell offers the `common` domain.

## 0.8.0

### Minor Changes

- 4c5a25e: Applets can upload files (NAP-UPLOAD) through Blossom. `kernl.files` follows the account's file-server list (kind 10063) with well-known defaults. `createBlossomUploader` uses `blossom-client-sdk` to upload to the first server and mirror to the rest, succeeds when any server stores the file, and asks the person before each file leaves with a new `public` consent severity. The shell offers the `upload` domain.

## 0.7.0

### Minor Changes

- 2fabe01: Add `@kernlize/core/cache`: an event cache behind one adapter contract. `openEventCache` opens the first adapter that works and falls back to memory; `defaultWebCacheAdapters()` is sqlite-wasm over the OPFS SAH pool in a worker, then IndexedDB, then memory. `fromEventDatabase` wraps any applesauce event database, and `attachEventCache` wires a cache to an `EventStore` and its loaders. A damaged sqlite database is wiped, rotated or given up on, never read.
- 0875fac: Load profiles for the UI: `kernl.profiles` (`createProfiles`) asks the lookup relays and then the author's own write relays, with no timeout, and the session label follows the account's published name. The store streams (`kernl.catalog.stream`, `streamCatalog`), lists cached manifests first, says when nothing has arrived yet (`CATALOG_SETTLE_MS`) and leaves out manifests their publisher deleted. Publishes succeed when any relay accepts (`publishAccepted`; kehto's outbox router is wrapped to accept partial success), profiles, follows and relay lists route to indexers plus the user's own and general servers, and an author without a relay list writes to the shell's. A relay-list consent reads "Change your inbox and outbox". `createKernl` composes `kernl.mailboxes`, `kernl.directory` and the `eventCache` option, the `outbox` tier follows the account's published outboxes, and `RelayTiers` gains `set()`.

  The applet catalogue tier now defaults to `relay.napplet.soy`, `relay.ditto.pub` and `relay.nostr.com`, the catalogues the public napplet stores read, so the store lists every napplet either lists. Manifests from the relays are kept in the event store, so the event cache holds them for the next visit.

  Conversations listed through the `dm` domain name their participants from published profiles (`labelConversations`, `Profiles.settled`), so a messaging applet shows names instead of account ids.

- 9b1006f: Publish outcomes, a relay directory and account mailboxes.

  `summarizePublish` and `describeOutcome` treat a publish any relay accepted as a success and say how many did (`PublishOutcome`). `createRelayDirectory` streams NIP-66 monitor reports from `DEFAULT_MONITOR_RELAYS` and offers `search` and `suggest`, falling back to `DEFAULT_SUGGESTIONS` with no reports. `createAccountMailboxes` streams the active account's NIP-65 list, says it is missing only once every lookup relay finished, and saves a new one to old and new relays and the lookup relays; `mailboxesFromEvent` and `mailboxTags` read and write the list. `toRelayUrl` and `relayUrls` normalise relay URLs. `subscribeWithEose` accepts any pool with `req`.

## 0.6.0

### Minor Changes

- ed91035: Messages become an applet, and the user orders the providers.

  `@kernlize/messaging`: the registry keeps providers in the user's order (`setOrder`, `list()` in order) and the first enabled one is the default; a send to someone new falls to the next enabled provider when the first cannot reach them. Before a one-to-one message leaves through a provider other than the one its recipient last wrote through, the reply rule decides: `ask` puts a `ReplyPrompt` to the new `askReply` option, `theirs` follows the correspondent, `mine` keeps the order (`setReplyRule`, `forgetReplyChoice`, `CompositeOptions.chooseReply`). A saved provider that cannot run yet now waits and starts when it can. Breaking: `MessagingPreferences` gains required `order`, `reply` and `replyChoices`, `defaultProvider` is derived from the order, and `MessagingRegistryOptions.preferences` takes `SavedMessagingPreferences`.

  `@kernlize/core`: `KernlOptions.builtins` lists applets the host ships; `kernl:<id>` decodes to a `builtin` pointer and resolves from bytes pinned by SHA-256, with no manifest lookup (`resolveBuiltin`, `builtinAddress`, `BUILTIN_PUBLISHER`, `BuiltinApplet`, `PublishedPointer`, `AppletSummary.builtin`, reason `invalid:artifact-hash`). `KernlHost.chooseReply` carries the reply question to the user. `createDefaultMessaging` switches `private` and `legacy` on for someone who has never chosen. Breaking: `AppletPointer` has a third kind, and `fetchManifestEvent` takes a `PublishedPointer`.

### Patch Changes

- Updated dependencies [ed91035]
  - @kernlize/messaging@0.4.0

## 0.5.0

### Minor Changes

- 5119e09: Add the applet store and intents. `kernl.catalog.load()` lists signed applet manifests from the applet and public relays, with `searchCatalog` and `popularTopics` for search and topic filters. `createKernl` now offers the `intent` domain: kernl's router over kehto's catalogue resolver picks the user's default, their published handler preference (kind 31129) or asks through the new optional `KernlHost.chooseHandler`, and delivers to the handler through `KernlHost.openApplet`. `kernl.intents` exposes the installed set and handler defaults, and `kernl.install` installs a verified applet without opening it. `AppletSummary.address` is now required and `summarize` takes it, which is a breaking change.

## 0.4.1

### Patch Changes

- 5563bfe: Opening an applet address no longer depends on every relay behaving. `fetchManifestEvent` ignores hints that are not relay URLs, survives relays that are down, silent or hang up, no longer lets a quick relay with nothing end the lookup before a slower catalogue answers, and falls back to the `super` tier when the address's relays and the `apps` tier do not produce the manifest; each round ends within `MANIFEST_TIMING.timeoutMs`, and it takes an optional `timing` argument. No relay answering is the new reason `unavailable:network` where it used to be the relay library's unprefixed error. `decodePointer` finds an encoded address inside a link or a sentence. The `identity` service answers `identity.getPublicKey` for a read-only account, through the new optional `KernlServiceDeps.auth.getUserPubkey`.
- 155318e: `fetchManifestEvent` asks a round of relays once more when every one of them refused the connection, after `MANIFEST_TIMING.retryDelayMs`. A busy public relay answers a websocket upgrade with 502 or 503 for a moment, and one such refusal no longer fails an applet lookup. `ManifestTiming` gains `retryDelayMs`.

## 0.4.0

### Minor Changes

- 81fbff7: Add `@kernlize/core/crypto`: `installCryptoFallback` fills in `crypto.randomUUID` and a pure-JS `crypto.subtle` outside a secure context (onion or overlay addresses over HTTP). The mount plan gives applet frames a `randomUUID` fallback.

## 0.3.1

### Patch Changes

- a845ea5: Window management is a replaceable interface, and layouts are a registry (D-022).

  - New `createWindowManager` and the `WindowManager` interface: placement, focus, stacking, minimising and what the guard is told about each window, with no DOM, publishing `WindowManagerState` on `state$`.
  - New `createLayoutRegistry` and `createDefaultLayouts`: the layouts a window manager offers. `createDefaultLayouts` holds `floating`, `dwindle`, `columns` and `master-stack`.
  - New entry `@kernlize/core/wm`, exporting the layouts, the registry and the window manager without the network stack. The same names are exported from the main entry, which now also re-exports `LayoutStrategy`, `Rect`, `WindowPlacement` and `WindowState` from `@kehto/wm`.
  - `LayoutOptions.margin` sets the space between the windows and the container edge and defaults to `gap`.
  - The tiling layouts round rectangle edges rather than sizes, so neighbours never overlap or leave a hole when the space does not divide evenly. A width that does not divide evenly can differ by one pixel from before.

## 0.3.0

### Minor Changes

- 5726a3d: Publish npm packages under `@kernlize/*` and the same releases on JSR under `@kernl/*`. Update internal imports and the exported `PACKAGE_NAME` constants to the npm names. Generate JSR sources and dependency maps from the workspace and installed lockfile versions.
- 9b824bb: Adopt the host seams released in `@kehto/shell` 0.32.0, `@kehto/runtime` 0.28.0 and `@kehto/firewall` 0.7.0 (D-020).

  - Port traffic is decided through `ShellAdapter.filterNappletMessage`. `GuardPipeline.observe` now returns kehto's `NappletMessageDecision` (`dispatch`, `defer` or `drop`). Breaking: `refuseCurrentDispatch` is removed, and what the guard will not let through is dropped with no reply instead of refused with a `firewall:` error.
  - A hidden window's non-control requests are held and released with `ShellBridge.releaseDeferred` when it becomes visible (`GuardPipelineOptions.onRelease`), instead of refused. The `deferred-overflow` revocation removes the frame like every other reason.
  - The adapter sets `aclDefaultPolicy: 'restrictive'`; `KernlGrants.ensure` grants what the record needs and revokes only what the stored entry holds beyond it.
  - Breaking: `ShellAdapterDeps` replaces `onNappletMessage` with `filterNappletMessage`, `getFocusContext` and `runtimeFirewall`.
  - New `applyRuntimeFirewallProfile`, `createRuntimeFirewallHooks`, `toGuardEvent` and `RUNTIME_FIREWALL_STORAGE_KEY`: the runtime firewall gets the profile's unfocused multiplier and startup burst on boot and on every profile change, open windows get the new rates, runtime refusals become guard events without the applet's message, and the runtime firewall's configuration is kept at `kernl:firewall:v1`.
  - Requires `@kehto/services` ^0.30.1, `@napplet/core` >=0.38.0 <0.39.0 and `@napplet/nap` >=0.37.0 <0.38.0.

### Patch Changes

- Updated dependencies [5726a3d]
- Updated dependencies [9b824bb]
- Updated dependencies [9b824bb]
  - @kernlize/bridges@0.2.1
  - @kernlize/guard@0.1.1
  - @kernlize/messaging@0.3.0

## 0.2.0

### Minor Changes

- 50e5851: Add `createPrivateMessagesBackend` and `createLegacyMessagesBackend`, which carry messages with only the active account's signer, and wire them as the default `private` and `legacy` backends in `createKernl`. Availability now follows the active account. `MESSAGING_UNAVAILABLE_REASONS` is now `{ signInRequired, signerCannotEncrypt, noRuntime }`; `needs-local-key-signer` and `not-implemented` are gone.
- c9cb0a7: Add the `group` messaging provider: group sessions (Marmot, MLS over nostr) over `@internet-privacy/marmot-ts`, with the account signer for identity and invitations and every library store sealed to the account. `@kernlize/messaging` exports `createGroupMessagesProvider`; `@kernlize/core` exports `createGroupMessagesBackend`, `createSealedGroupStore` and `createGroupNetwork`, and `createKernl` wires the provider.
- c9cb0a7: Add `createWebTorrentBackend`, a dependency-free `TorrentBackend` over a structural WebTorrent client that downloads magnet links inside the page, keeps only `wss://` trackers plus `DEFAULT_WEBRTC_TRACKERS`, and exposes `jobs`, `subscribe`, `pause`, `resume`, `remove` and `files`. `BackendTraits.handoff` is read on every availability check. `createDefaultBridges` takes an optional `torrent` backend that wins over the hand-off for magnet links, and `KernlOptions.torrent` passes one through `createKernl` (D-017).
- c9cb0a7: Add `createRatchetMessagesBackend`, ratchet sessions over the `nostr-double-ratchet` runtime with the account signer signing the device list, and `createSealedRatchetStorage`, which keeps the library's device and session keys only as `nip44` ciphertext sealed to the account. `createKernl` wires it as the default `ratchet` backend, available while the signer has `nip44` (D-016).

### Patch Changes

- Updated dependencies [c9cb0a7]
- Updated dependencies [c9cb0a7]
  - @kernlize/messaging@0.2.0
  - @kernlize/bridges@0.2.0
