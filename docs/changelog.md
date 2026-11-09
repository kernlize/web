# Changelog

Each entry says what ships, per package and app. [Alpha status](./alpha-status.md) is the current picture; this page is the history. Versions follow semver on 0.x: a breaking change is a minor bump.

## Unreleased

### `@kernlize/bridges`

- `createWebTorrentBackend({ client, trackers?, now?, progressIntervalMs? })`: a `TorrentBackend` that downloads inside the page through a structural `WebTorrentLike` client or a loader for one. It keeps only `wss://` trackers plus `DEFAULT_WEBRTC_TRACKERS` (`webTrackers` is the filter) and adds `jobs`, `subscribe`, `pause`, `resume`, `remove` and `files`. Errors: `invalid:info-hash`, `unavailable:<why>`, `unavailable:not-finished`, `denied:unknown-download` ([D-017](./decisions.md#d-017)).
- `BackendTraits.handoff` is typed `true | undefined` and is read on every availability check, so a backend may switch between moving data itself and handing off.

### `@kernlize/core`

- Built-in applets ([D-027](./decisions.md#d-027)): `KernlOptions.builtins` lists applets the host ships, `kernl:<id>` decodes to a `builtin` pointer, and `Kernl.resolve` loads the bytes and checks them against the pinned SHA-256 with no lookup. New exports `resolveBuiltin`, `builtinAddress`, `BUILTIN_PUBLISHER`, `BuiltinApplet` and `PublishedPointer`; `AppletSummary.builtin`; new reason `invalid:artifact-hash`. **Breaking** for exhaustive switches over `AppletPointer['kind']`, and `fetchManifestEvent` takes a `PublishedPointer`.
- `KernlHost.chooseReply` carries the messaging registry's reply question to the user; `createDefaultMessaging` takes it as `askReply`.
- `createDefaultMessaging` switches `private` and `legacy` on for someone who has never chosen; each starts once an account that can run it signs in.

- The applet store: `kernl.catalog.load()` over `loadCatalog`, with `toCatalogEntry`, `addressOf`, `newestEntries`, `searchCatalog`, `fuzzyScore` and `popularTopics` ([D-026](./decisions.md#d-026)).
- Intents: `createKernl` offers the `intent` domain through kehto's `createIntentService` and kernl's `createIntentRouter` and `createIntentDelivery`. `kernl.intents` exposes the installed set and the user's handler defaults; `kernl.install(summary)` installs a verified applet without opening it, and `kernl.plan` installs the applet it plans. `KernlHost` gains the optional `chooseHandler`, `openApplet` and `focusApplet`; `KernlOptions.intentRetry` tunes delivery.
- Handler preferences (kind 31129): `createHandlerDefaults`, `parseHandlerPreferences`, `preferenceTemplate`, `preferredHandlers`, `catalogIdForRef` and `refForCatalogId`. The signed-in account's preferences are read on sign-in; publishing is opt-in. `describeChange` names the archetype and the applets added and removed when an applet writes one.
- **Breaking.** `AppletSummary.address` is required, and `summarize(resolved, address)` takes it.
- `@kernlize/core/crypto` (`@kernl/core/crypto` on JSR): `installCryptoFallback` adds `crypto.randomUUID` and a pure-JS `crypto.subtle` where the browser withholds them outside a secure context, such as an onion or overlay address served over HTTP. The shell installs it first, and the mount plan gives every applet frame a `randomUUID` fallback ([D-024](./decisions.md#d-024)).
- `createWindowManager(options?)` and the `WindowManager` interface: placement, focus, stacking, minimising and what the guard is told about each window, with no DOM, publishing `WindowManagerState` on `state$`. `createLayoutRegistry` and `createDefaultLayouts` hold the layouts it offers; a layout of your own is one `register` ([D-022](./decisions.md#d-022)).
- `@kernlize/core/wm` (`@kernl/core/wm` on JSR): a second entry exporting the layouts, the registry and the window manager, importing only `rxjs`. The same names stay on the main entry, which now also re-exports `LayoutStrategy`, `Rect`, `WindowPlacement` and `WindowState` from `@kehto/wm`.
- `LayoutOptions.margin`: the pixels between the windows and the container edge, defaulting to `gap`. The tiling layouts now round rectangle edges rather than sizes, so two windows that share an edge never overlap or leave a hole when the space does not divide evenly.

- Opening an address no longer depends on every server behaving ([D-025](./decisions.md#d-025)). `fetchManifestEvent` drops hints that are not relay URLs, survives relays that are down, silent or hang up, no longer lets a quick relay with nothing to say end the lookup before a slower catalogue answers, and falls back to the `super` tier when the address's relays and the `apps` tier do not produce the manifest. Each of the two rounds ends within `MANIFEST_TIMING.timeoutMs`, and a round whose relays all refused the connection is asked once more after `MANIFEST_TIMING.retryDelayMs`. It takes an optional `timing` argument, and `MANIFEST_TIMING` and `ManifestTiming` are exported.
- New reason `unavailable:network` from `fetchManifestEvent` and `Kernl.resolve`: no relay answered. Before, this surfaced as the relay library's own error with no kernl prefix, after up to thirty seconds.
- `decodePointer` finds an encoded address inside a link or a sentence.
- A read-only account is an account a granted applet can be shown: the `identity` service answers `identity.getPublicKey` for it. `KernlServiceDeps.auth` gains an optional `getUserPubkey`.

- `createDefaultBridges` takes an optional `torrent` backend that replaces the hand-off for magnet links only; `KernlOptions.torrent` passes one through `createKernl`.

- `createPrivateMessagesBackend`: NIP-17 messages over the account signer. The seal is signed by the account with `nip44`; the wrap is signed by an ephemeral key that lives inside an applesauce `PrivateKeySigner` and is discarded after the wrap. Sends go to the recipient's kind 10050 inbox relays, falling back to the user's `outbox` and `super` tiers, with a copy wrapped to the user ([D-015](./decisions.md#d-015)).
- `createRatchetMessagesBackend` and `createSealedRatchetStorage`: ratchet sessions over the `nostr-double-ratchet` library's `NdrRuntime`, with the account signer signing the device list and the library's device and session keys stored only as `nip44` ciphertext sealed to the account. `createKernl` wires it as the default `ratchet` backend, available while the signer has `nip44`; `ratchet` no longer reports `no-runtime` in the live shell, and applets reach it through the `dm` domain like the other providers ([D-016](./decisions.md#d-016)).
- `createGroupMessagesBackend`, `createSealedGroupStore` and `createGroupNetwork`: group sessions (Marmot, MLS over nostr) over `@internet-privacy/marmot-ts`, with the account signer for identity and invitations and every library store sealed to the account with `nip44`. `createDefaultMessaging` registers the `group` provider and `createKernl` wires it; `MessagingBackendFactories` gains `group`.
- `createLegacyMessagesBackend`: NIP-04 kind 4 messages through `signer.nip04`, normalised the same way and still marked metadata-exposing.
- `createKernl` wires both by default unless `KernlOptions.messagingBackends` overrides them, so `private` and `legacy` work in the live shell. Availability follows the active account: `private` needs a signer with `nip44`, `legacy` one with `nip04`.
- **Breaking.** `MESSAGING_UNAVAILABLE_REASONS` now holds `sign-in-required`, `signer-cannot-encrypt` and `no-runtime`. `needs-local-key-signer` and `not-implemented` are removed. See [Error reasons](./reference/errors.md).
- **Breaking.** `planMount` enables kehto's released nested-context lock, `experimental: { nestedContextLock: true }` from `@kehto/shell` 0.30.0, in place of kernl's port of it. kehto now renders the Trusted Types directives, installs the `default` policy and pins the element factories; its `assertNappletHasNoFrame` still maps to `denied:nested-frame`. Frame creation inside an applet now throws `TypeError('kehto: napplets may not create nested browsing contexts')`; insertion still throws `denied:nested-frame` ([D-014](./decisions.md#d-014)).
- `@kehto/shell` is now `^0.30.0`. The other kehto packages are unchanged.

### `@kernlize/messaging`

- Providers are kept in the user's order ([D-027](./decisions.md#d-027)). `MessagingRegistry.setOrder(ids)` reorders them, `list()` returns them in order, and the first enabled provider is the default; a send to someone new falls to the next enabled provider when the first answers `unavailable:recipient-not-ready`.
- The reply rule: before a one-to-one message leaves through a provider other than the one its recipient last wrote through, `ask` puts a `ReplyPrompt` to `MessagingRegistryOptions.askReply`, `theirs` follows the correspondent and `mine` keeps the order. `setReplyRule`, `forgetReplyChoice`, and `CompositeOptions.chooseReply` on `createCompositeBackend`. A dismissed question rejects with `denied:cancelled`.
- A saved provider that cannot run when it registers now waits and starts when it can, and stays in the saved list meanwhile.
- **Breaking.** `MessagingPreferences` gains required `order`, `reply` and `replyChoices`; `MessagingRegistryOptions.preferences` takes `SavedMessagingPreferences`, which accepts older snapshots. `defaultProvider` is now derived from the order: enabling a provider with nothing else on makes it the default, and `setDefault` moves a provider to the top.

- `createGroupMessagesProvider`: the `group` provider, "Group sessions". Forward secrecy, post-compromise security and groups; experimental; specification `Marmot (MLS, RFC 9420; supersedes NIP-EE)`.

### `@kernlize/guard`

- `renderFrameLockScript` is renamed `renderInsertionLockScript` and emits `<script data-kernl-insertion-lock>`, which applies only the insertion lock: the DOM insertion pins, the refusal of custom elements that extend frame elements, and the removal of `XSLTProcessor`. kehto's lock guards creation only, so the insertion lock stays until kehto guards insertion; the four routes past kehto's lock are to be reported upstream.
- **Breaking.** Removed `appletMarkupHasFrame`, `assertAppletHasNoFrame`, `TRUSTED_TYPES_DIRECTIVES` and the `trustedTypes` field of `AppletCsp`. `createAppletCsp` returns the 14 baseline directives only, and `@kernlize/guard` no longer throws outside the applet realm.

### Shell and site (`apps/web`)

- Messages are an applet ([D-027](./decisions.md#d-027)). The Messages panel is gone; the button opens the Messages applet the shell ships (`applets/messages`, built with the napplet toolchain, pinned by hash), or the applet the user chose for messages. It shows one conversation per person across providers, keeps drafts, counts unread itself and follows the shell's colours. The preview runs the same bytes over a real message port.
- Settings has a Messages section: the providers in the user's order with move up, move down and on or off, what each protects, the reply rule, and a button that forgets kept answers. The per-conversation provider picker is gone.
- A reply to someone who last wrote through a provider other than the first in the order opens a question first: send it their way or keep the order, for this message, this person or everyone.
- The count on the Messages button is the shell's own: messages that arrived, after Messages was first opened, while no messages window had focus.
- Applets that ask for the theme are told the shell's colours when they open.

- The launcher is a store: fuzzy search, topic bubbles, a filter for applets this shell can run fully, and an address pasted into the search still opens. **Yours** lists installed applets and which one opens each kind of request, with an opt-in to keep those choices with the account. When an applet asks another to do something, the shell picks the user's default, or asks with a chooser that can also find a handler in the store. The sample applets are gone; the preview's store lists its own applets, and its Notes can ask its Profiles to open a profile.
- The landing at `/` is now one screen and two adoption paths: add applets to an application you have, or start a shell from the reference one. What the home page held before is at `/about/`, with the five pages beneath it at `/about/<page>/`; their old addresses redirect. Moving between the site's pages no longer reloads the document: a WebGL curtain crosses the screen and the new page's content rises into place. Reduced motion, no WebGL and no scripts each leave a whole, still page ([D-023](./decisions.md#d-023)).

- The Messages panel lists "Group sessions" beside the other providers, unranked; a send to someone who has not set it up says so in plain words. The site's vocabulary check also refuses the group protocol's names.

- Magnet links download inside the shell. A Downloads panel lists each download with progress, peers and speed, and offers pause, resume, remove and Save. Settings has a Downloads choice, "Download in kernl" (the default where the browser can connect to peers) or "Open in an app on your device", remembered under `kernl:downloads:mode:v1`. The shell host page loads `webtorrent` 3.0.21 (browser build) on the first download only; applet frames are unchanged. The preview downloads from nobody and finishes each download with a short text file.

- The Messages panel sends and receives private and legacy messages for an account whose signer can encrypt (browser extension, remote signer, password-protected local account). It opens the user's own messages without a consent prompt; applets still reach messages only through the `dm` grant.

- The shell's windows are run by kernl's window manager, made in one file, `windows.ts`. The bar's layout control steps through four layouts (floating, tiled, columns, main and stack) instead of two, and the choice is stored by id; `tiled` from an earlier build still reads. How to change the layouts or replace the manager is in two new how-tos ([D-022](./decisions.md#d-022)).

## 0.1.0 — first draft, 2026-11-03

The first version of every package and of the shell. Nothing is published to npm yet; the packages are used from the source repository, which is private during the alpha ([Packages](./packages/index.md#install)).

### `@kernlize/guard` 0.1.0

- Three profiles, `strict`, `balanced` and `relaxed`, from `createGuardConfig`, and `applyNappletRules` for kehto's runtime firewall.
- Envelope classification, ingress flood control with quarantine, the visibility gate, and the focus-aware firewall over `@kehto/firewall`'s `evaluate()`.
- The fixed zero-network CSP from `createAppletCsp`, with the Trusted Types directives the frame lock needs.
- The nested-frame lock: a port of kehto's unreleased `experimental.nestedContextLock` ([D-014](./decisions.md#d-014)), described under Security below.
- Eleven mitigation descriptions for the guard panel. Pure; its one dependency is `@kehto/firewall`. See [`@kernlize/guard`](./packages/guard.md).

### `@kernlize/messaging` 0.1.0

- The `MessagingProvider`, `MessagingBackend` and `MessagingRegistry` contracts, with saved-preference restore.
- The composite backend with `provider:innerId` namespacing, and `describeProvider` rows.
- A complete in-memory backend, `createMemoryBackend`, used by the preview and the tests.
- Three providers, `private`, `legacy` and `ratchet`, built with `defineProvider` from backends the host injects. No real backend ships, so all three are unavailable in the live shell. See [`@kernlize/messaging`](./packages/messaging.md).

### `@kernlize/bridges` 0.1.0

- `parseLocator` for the web schemes, `magnet:`, `nzb:`, `slsk:` and `mailto:`, with `formatLocator` and `isNzbUrl`.
- The `Bridge` contract, the registry with its `authorize` hook and outcome events, and `describeBridge` rows.
- A complete HTTP bridge with an SSRF policy: `https` only, private and local destinations blocked, a byte limit on the streamed body, and opaque redirects refused in the browser.
- The torrent, NZB, Soulseek and mail bridges, and `createHandoffBackends`, which serves all four by opening the locator's canonical address in an app on the user's device ([Bridges](./concepts/bridges.md#hand-off-backends)).
- `createBridgeResourceResolver` for kehto's resource service. See [`@kernlize/bridges`](./packages/bridges.md).

### `@kernlize/core` 0.1.0

- `createKernl`, the composition root: one applesauce `EventStore`, `RelayPool` and `AccountManager` over kehto's `createShellBridge`, exercised end to end in `kernl.feature`.
- Applet pointer decoding, manifest resolution, the mount plan and mounting.
- Grants over `bridge.runtime.aclState`, the restrictive environment resolver, and consent summaries for destructive writes.
- [Relay tiers](./concepts/relay-tiers.md), [persistence](./concepts/persistence.md) under the `kernl:` prefix with plaintext keys refused, the guard pipeline and runtime firewall rules, the default messaging and bridge registries, and four [layouts](./concepts/layouts.md). See [`@kernlize/core`](./packages/core.md).

### Shell and site (`apps/web`)

- The landing site at `/` and the shell at `/app/`.
- Sign-in with a browser extension, a remote signer, a read-only address or a password-protected local account.
- Open an applet by address, with its required and optional domains as choices.
- Floating and tiled windows, with a compact layout at 720 px and below.
- A grants panel per window, the shell-wide guard panel with its event log, the provider picker, and Settings for relay tiers.
- The offline preview behind `?preview=1` ([D-011](./decisions.md#d-011)), hosted at [kernlize.github.io/app/?preview=1](https://kernlize.github.io/app/?preview=1).

### Docs

These pages, the TypeDoc API reference, `llms.txt` and a Markdown twin of every page, checked by `pnpm docs:check`: TypeDoc in strict mode, the docs audit, and every TypeScript sample compiled against the package sources.

### Security

The nested-frame lock ([D-014](./decisions.md#d-014)) closes a path an independent review found: applet code could create a child frame whose fresh realm still had a working `RTCPeerConnection`, which reached a public STUN server. `@kehto/shell` 0.29.0 removes the peer-connection globals from the applet's own realm only, and CSP does not govern WebRTC. The lock has three parts:

- **Static markup.** `assertAppletHasNoFrame` refuses frame, object and embed markup in the verified bytes with `denied:nested-frame` before they become a srcdoc.
- **Creation.** `renderFrameLockScript` installs a Trusted Types `default` policy that refuses frame markup at every HTML string sink, and pins the element factories so they refuse frame tag names. It runs before any applet script.
- **Insertion.** A second review found four creation routes past the factory pins. Because a frame only gets a realm once it is connected to the document, `appletInsertionLock` pins every DOM insertion method, including `Range.insertNode` and `Range.surroundContents`. It refuses any node that is, or contains, an HTML-namespace frame element. It reads node identity through native getters captured before applet code runs, refuses custom elements that extend frame elements, and removes `XSLTProcessor`.

`tests/e2e/applet-network-sealed.spec.ts` probes every route the reviews found, and thirteen insertion routes, and sees no child realm and no candidate. The cost: every DOM insertion in an applet walks the inserted subtree once.

### Corrections

Recorded in [Alpha status](./alpha-status.md#corrections), both on 2026-11-03:

- **Rate enforcement.** Earlier drafts said kehto's runtime firewall refused envelopes over the profile's rates. It did not, because `applyRuntimeFirewallRules` also set each applet's runtime policy to `allow`, which passes before any rate is checked. The policy call is removed, the rates and kehto's startup burst guard now refuse before dispatch, and [D-012](./decisions.md#d-012) is rewritten.
- **Size caps.** The guard's size matchers were described as able to fire in the shell. The ingress guard rejects the same envelopes first, so they could not. Oversized downloads and queries were reported but still handled; they are now refused before dispatch.
