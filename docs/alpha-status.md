# Alpha status

kernl is a first draft. This page says what runs, what is a contract without an implementation, and which upstream gaps are open. It is updated in the same pull request as the code it describes.

## What works

| Area | Package | State |
| --- | --- | --- |
| Guard | `@kernlize/guard` | Three profiles (`createGuardConfig`, `applyNappletRules`), envelope classification, ingress flood control with quarantine, visibility gate, focus-aware firewall over `@kehto/firewall`'s `evaluate()`, the fixed zero-network CSP, an insertion lock on top of kehto's nested-context lock ([D-014](./decisions.md#d-014)), eleven mitigation descriptions for the UI. Pure, fully specified in `packages/guard/features/`. |
| Messaging | `@kernlize/messaging` | `MessagingProvider`, `MessagingBackend`, `MessagingRegistry` with saved-preference restore, the composite backend with `provider:innerId` namespacing, `describeProvider` rows, a complete in-memory backend (`createMemoryBackend`) used by the preview and the tests, and three providers (`private`, `legacy`, `ratchet`) built with `defineProvider` from backends the shell injects. The network backends for `private` and `legacy` are in `@kernlize/core` (`createPrivateMessagesBackend`, `createLegacyMessagesBackend`) and are wired in the live shell ([below](#messaging-providers-in-the-live-shell)). |
| Bridges | `@kernlize/bridges` | `Locator` parsing for the web schemes, `magnet:`, `nzb:`, `slsk:` and `mailto:`, the `Bridge` contract, the registry with its `authorize` hook and outcome events, a complete HTTP bridge with SSRF policy, the four backend-driven bridges up to their backend interface, `createHandoffBackends`, which serves all four by opening the locator in an app on the user's device, `createWebTorrentBackend`, which downloads magnet links inside the shell page over WebRTC, `createBridgeResourceResolver` for kehto's resource service, and `describeBridge` rows. |
| Composition | `@kernlize/core` | `createKernl` over one applesauce `EventStore`, `RelayPool` and `AccountManager`, with kehto's real `createShellBridge` exercised end to end in `kernl.feature`: an applet is decoded, resolved, planned and mounted, binds its port through the guarded `handleWindowMessage`, completes `shell.ready`, is answered by the theme, identity and resource services, and is quarantined and revoked when it floods. Relay tiers, the applesauce adapters, the guard pipeline and runtime firewall rules, grants over `bridge.runtime.aclState`, consent summaries, the default registries and the layouts each have their own feature file. |
| Shell UI | `apps/web` | Landing site at `/` and the shell at `/app/`: sign-in (browser extension, remote signer, read-only, password-protected local account), open by address with the required and optional domains as choices, windows, a grants panel per window, a shell-wide guard panel with the event log, the provider picker, and the offline preview behind `?preview=1` ([D-011](./decisions.md#d-011)), hosted at [kernl.run/app/?preview=1](https://kernl.run/app/?preview=1). |

"Works" means the behaviour has a scenario in `packages/*/features/`, the scenario passes, and the page describing it exists. It does not mean the API is stable. Every package is `0.1.0`; on 0.x a breaking change is a minor bump.

## Messaging providers in the live shell

`createKernl` registers all three providers and, unless `KernlOptions.messagingBackends` overrides them, wires two real backends from `@kernlize/core`: `createPrivateMessagesBackend` for `private` (NIP-17 gift-wrapped messages) and `createLegacyMessagesBackend` for `legacy` (NIP-04 direct messages). Both sign and encrypt with the active account's signer and nothing else ([D-015](./decisions.md#d-015)). Availability follows the active account, and an unavailable provider reports a reason from `MESSAGING_UNAVAILABLE_REASONS`:

| Provider | Available when | Reason otherwise |
| --- | --- | --- |
| `private` | The active account's signer exposes `nip44` (browser extension, remote signer, password-protected local account) | `sign-in-required` with no active account; `signer-cannot-encrypt` when the signer has no `nip44` (a read-only account) |
| `legacy` | The active account's signer exposes `nip04` | `sign-in-required` with no active account; `signer-cannot-encrypt` when the signer has no `nip04` |
| `ratchet` (experimental) | The active account's signer exposes `nip44`, which seals the session state kept on this device | `sign-in-required` with no active account; `signer-cannot-encrypt` without `nip44` |
| `group` (experimental) | The active account's signer exposes `nip44`, which opens invitations and seals the group state kept on this device | `sign-in-required` with no active account; `signer-cannot-encrypt` without `nip44` |

`private` sends to the recipient's kind 10050 inbox relays, falling back to the sender's `outbox` and `super` tiers when the recipient publishes none, and wraps a copy to the sender so the conversation reads the same on every device. `legacy` is metadata-exposing: sender, recipient and timing are public on the event, and the picker says so. The Messages panel decrypts the user's own messages without a consent prompt, because the shell asks on the user's behalf; an applet reaches messages only through the `dm` domain grant. The preview still uses the in-memory backend.

## What does not work yet

- **In-shell transfers for NZB, Soulseek and mail.** Magnet links download inside the shell page by default ([D-017](./decisions.md#d-017)): a WebTorrent client loaded on the first download reaches browser peers over WebRTC, and the Downloads panel shows progress and lets the user pause, resume, remove and save. It reaches only peers that speak WebRTC, so a link whose swarm has none stays "Looking for peers"; the user can switch to "Open in an app on your device" in Settings. Downloads live in memory and end when the tab closes. NZB, Soulseek and mail still work only by hand-off, after the user confirms leaving kernl, because their protocols need raw TCP sockets a page cannot open. A `job` result from a hand-off is an id, not a transfer kernl can track, and it is reported even when the user declines to leave. See [Bridges](./concepts/bridges.md#downloads-inside-kernl).
- **Ratchet sessions, beyond one to one on a shared relay.** `ratchet` works in the live shell ([D-016](./decisions.md#d-016)) but is experimental: sessions are one to one, both sides must share an `outbox` or `super` relay, the conversation list is in memory and empties on reload (sessions and keys survive, sealed to the account), the first use waits up to the library's 12 s for the account's device list, and an extension or remote signer is asked to decrypt each stored value once per page load and to encrypt each write. The preview reports it unavailable with `no-ratchet-runtime`. See [Messaging](./concepts/messaging.md).
- **Group sessions, beyond the basics.** `group` works in the live shell ([D-018](./decisions.md#d-018)) but is experimental and runs an alpha library: messages are kept in memory, so a reload empties each group's history (membership and secrets survive, sealed to the account); an account is one member of a group, so only one of a person's devices joins it; people can be added only when they have published a key package, which kernl does when the provider is first used; there is no way yet to name a group, add or remove members after it starts, or leave it; and an extension or remote signer is asked to decrypt each sealed store once per page load and to encrypt each write. Relay-based groups (NIP-29) are not offered, because they are not end-to-end encrypted. The preview reports `group` as needing a sign-in. See [Messaging](./concepts/messaging.md#protocol-inventory).
- **Web fetch from the browser shell, beyond the simple case.** The HTTP bridge runs in the page, so it is subject to CORS, and an opaque redirect it cannot inspect is refused with `denied:redirect-unverifiable`. Web fetch works from the shell for `https` origins that permit cross-origin reads and answer without a redirect. Hostnames are checked as literals only; no resolver is wired. See [Bridges](./concepts/bridges.md#the-http-bridge).
- **Per-host bridge consent.** `createKernl` builds the bridge registry with `createDefaultBridges()` and no `authorize` hook, so a `resource` request from a granted applet is checked by the HTTP bridge's SSRF policy and nothing else. A host that wants a prompt per host or scheme passes its own registry in `KernlOptions.bridges`.
- **Per-applet guard profiles.** `GuardFacade.setProfile` rebuilds the pipeline for the whole shell and is not persisted. The per-applet, remembered override [D-003](./decisions.md#d-003) describes is not in this draft.
- **Mobile layouts beyond the basics.** The layouts are desktop tilings over `@kehto/wm` ([Layouts](./concepts/layouts.md)). At 720 px wide and below the shell switches to a compact layout: every window fills the desktop, and the bar keeps **Open** and moves the guard, messages, layout, minimised windows, settings and sign-out into a **Menu** sheet; panels open as full-width sheets. There are no gestures. Every open window is reported to the guard as visible there, although only the front one can be seen: kernl's window manager does not yet treat a window wholly covered by another as hidden ([Layouts](./concepts/layouts.md#what-the-guard-is-told)).
- **Multi-account switching.** `AccountManager` holds several accounts and the sign-in panel lists them, but switching means signing out and in.
- **Grant persistence across devices.** Grants, relay tiers and messaging preferences persist in the host's storage only. There is no sync. Every key is listed in [Persistence](./concepts/persistence.md).
- **Published packages.** Nothing is released yet, neither `@kernlize/*` on npm nor `@kernl/*` on JSR; they are used from a clone of the source repository, which is private during the alpha. See [Packages](./packages/index.md#install).
- **Source links in the API reference.** `typedoc.json` sets `packageOptions.disableSources: true`, so the generated reference has no "Defined in" source links. They would point at the source repository, which is private during the alpha.

The [Roadmap](./roadmap.md) orders this list.

## Upstream gaps

kernl composes kehto rather than forking it ([D-001](./decisions.md#d-001)). The four seams kernl filed against `kehto/web` ([#397](https://github.com/kehto/web/issues/397), [#398](https://github.com/kehto/web/issues/398), [#399](https://github.com/kehto/web/issues/399), [#400](https://github.com/kehto/web/issues/400)) are closed in `@kehto/shell` 0.32.0, `@kehto/runtime` 0.28.0 and `@kehto/firewall` 0.7.0, and kernl uses them ([D-020](./decisions.md#d-020)):

1. **Firewall hooks through `ShellAdapter` (#397).** kernl passes `getFocusContext` (only `focused`), `onFirewallEvent`, which feeds the guard log without the applet's message, and `firewallPersistence`, which keeps the runtime firewall's configuration under `kernl:firewall:v1` in the host storage.
2. **ACL default policy (#398).** The adapter sets `aclDefaultPolicy: 'restrictive'`. `KernlGrants.ensure` grants the baseline and the user's domains and revokes only what an applet's stored entry holds beyond them.
3. **A hook that can hold or drop port traffic (#399).** `filterNappletMessage` runs kernl's guard pipeline for every port envelope. What the guard will not let through is dropped, with no reply to the applet. A hidden window's requests are held and released with `releaseDeferred` when it is visible. See [Guard](./concepts/guard.md#where-enforcement-happens).
4. **Unfocused multiplier and burst guard setters (#400).** On boot and on every profile change kernl sets the profile's `unfocusedMultiplier` and `burstGuard` on the runtime firewall and reinstalls the rates of open windows.

kernl's own layers stay in front of kehto where kehto cannot see what they see: envelope size for downloads and queries, window visibility, a separate deletion budget, and flood quarantine. The focus-aware firewall overlaps the runtime now and stays so that kernl's own decisions remain a complete source of guard events ([D-020](./decisions.md#d-020)).

One change upstream is pending. [kehto/web#336](https://github.com/kehto/web/pull/336) makes kehto's firewall a shared approval authority and moves rate limiting into a separate runtime budget. On a host that configures it, the multiplier and burst setters, `onFirewallEvent` and `firewallPersistence` are ignored, and `getFocusContext` is read for `focused` only. kernl keeps every use of those in one module, `packages/core/src/guard/runtime-rules.ts`, and will move it to `permissions.setRateLimit` and `onRateLimit` when #336 is released. `aclDefaultPolicy`, `filterNappletMessage` and `releaseDeferred` are unchanged by #336.

One gap is new with intents. kehto's ACL (`@kehto/acl` 0.20.3, and `main`) maps `intent.deliver` to no recipient capability, so the runtime's recipient-checked `sendToEligibleNapplet` refuses every delivery. kernl delivers over the target's bound port with `originRegistry.postToNapplet`, as kehto's reference host Paja does, after checking the target's live session holds `intent:read` ([D-024](./decisions.md#d-024)). It is to be raised upstream.

A fifth observation, not a gap kernl needs closed: the transport internals `createNip5dTransport` and `createShellReadyState` are not exported, so kernl uses `createShellBridge` unchanged.

One mitigation goes beyond kehto: `@kehto/shell` 0.30.0 ships `experimental.nestedContextLock`, which stops an applet creating a child frame whose fresh realm still has WebRTC, and `planMount` always enables it. kehto's lock guards creation only, and four creation routes get past it (a customized built-in constructed with `new`, XSLT, and a namespace-prefixed XHTML element brought in with `importNode` or `adoptNode`), so `@kernlize/guard` adds an insertion lock on top until kehto guards insertion. The routes are to be reported to kehto ([D-014](./decisions.md#d-014)).

## Corrections

- **Rate enforcement (corrected 2026-11-03).** Earlier drafts of these docs, the README and D-012 said kehto's runtime firewall refused envelopes over the profile's rates. It did not: `applyRuntimeFirewallRules` also set each applet's runtime policy to `allow`, and kehto's `evaluate()` returns `pass` for an `allow` policy before it looks at any rate, matcher or burst. No rate was refused before dispatch; only kernl's reports and quarantine applied. The policy call is removed, the rates and kehto's startup burst guard now refuse before dispatch, and D-012 is rewritten to match.
- **Size caps (corrected 2026-11-03).** The guard's size matchers were described as able to report `matcher:size:<class>` in the shell. They cannot fire there: the ingress guard rejects the same envelopes first. Oversized downloads and queries were reported but still handled; they are now refused before dispatch.
- **Focus tightening, bursts and hidden windows (changed 2026-11-04).** These were reported to the user but still handled. They were then refused before dispatch the same way size caps were (`refuseCurrentDispatch`): a request over the smaller unfocused budget, a request in a burst above the per-second rate, and any non-control request from a hidden window got a `firewall:` error. Control envelopes were never refused. See [D-012](./decisions.md#d-012).
- **Dropped and held, not refused (changed with kehto 0.32.0).** kernl now decides each port envelope through kehto's `filterNappletMessage`. Oversized requests, bursts and requests over the unfocused budget are dropped and get no reply; a hidden window's requests are held and answered once it is visible. The runtime's startup burst is the profile's (8 operations in a window's first second in `strict`) rather than kehto's default of 20 in 3 s. See [D-020](./decisions.md#d-020).

## Versions this draft is built against

| Dependency | Range |
| --- | --- |
| `@kehto/acl` | `^0.20.3` |
| `@kehto/firewall` | `^0.7.0` |
| `@kehto/runtime` | `^0.28.0` |
| `@kehto/shell` | `^0.32.0` |
| `@kehto/services` | `^0.30.1` |
| `@kehto/nip` | `^0.8.0` |
| `@kehto/wm` | `^0.0.2` |
| `applesauce-*` | `^7.0.x` |
| `@napplet/core` | `>=0.38.0 <0.39.0` (`@kernlize/core`); `>=0.37.0 <0.39.0` (`@kernlize/guard`, `@kernlize/messaging`) |
| `@napplet/nap` | `>=0.37.0 <0.38.0` |

The protocol itself is a draft. NIP-5D is [nostr-protocol/nips PR #2303](https://github.com/nostr-protocol/nips/pull/2303) and the NAP documents live at [napplet/naps](https://github.com/napplet/naps). kernl keeps no local copy of either; see [Spec conformance](./policies/spec-conformance.md).
