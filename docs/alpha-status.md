# Alpha status

kernl is a first draft. This page says what runs, what is a contract without an implementation, and which upstream gaps are open. It is updated in the same pull request as the code it describes.

## What works

| Area | Package | State |
| --- | --- | --- |
| Guard | `@kernl/guard` | Three profiles (`createGuardConfig`, `applyNappletRules`), envelope classification, ingress flood control with quarantine, visibility gate, focus-aware firewall over `@kehto/firewall`'s `evaluate()`, the fixed zero-network CSP, an insertion lock on top of kehto's nested-context lock ([D-014](./decisions.md#d-014)), eleven mitigation descriptions for the UI. Pure, fully specified in `packages/guard/features/`. |
| Messaging | `@kernl/messaging` | `MessagingProvider`, `MessagingBackend`, `MessagingRegistry` with saved-preference restore, the composite backend with `provider:innerId` namespacing, `describeProvider` rows, a complete in-memory backend (`createMemoryBackend`) used by the preview and the tests, and three providers (`private`, `legacy`, `ratchet`) built with `defineProvider` from backends the shell injects. The network backends for `private` and `legacy` are in `@kernl/core` (`createPrivateMessagesBackend`, `createLegacyMessagesBackend`) and are wired in the live shell ([below](#messaging-providers-in-the-live-shell)). |
| Bridges | `@kernl/bridges` | `Locator` parsing for the web schemes, `magnet:`, `nzb:`, `slsk:` and `mailto:`, the `Bridge` contract, the registry with its `authorize` hook and outcome events, a complete HTTP bridge with SSRF policy, the four backend-driven bridges up to their backend interface, `createHandoffBackends`, which serves all four by opening the locator in an app on the user's device, `createBridgeResourceResolver` for kehto's resource service, and `describeBridge` rows. |
| Composition | `@kernl/core` | `createKernl` over one applesauce `EventStore`, `RelayPool` and `AccountManager`, with kehto's real `createShellBridge` exercised end to end in `kernl.feature`: an applet is decoded, resolved, planned and mounted, binds its port through the guarded `handleWindowMessage`, completes `shell.ready`, is answered by the theme, identity and resource services, and is quarantined and revoked when it floods. Relay tiers, the applesauce adapters, the guard pipeline and runtime firewall rules, grants over `bridge.runtime.aclState`, consent summaries, the default registries and the layouts each have their own feature file. |
| Shell UI | `apps/web` | Landing site at `/` and the shell at `/app/`: sign-in (browser extension, remote signer, read-only, password-protected local account), open by address with the required and optional domains as choices, windows, a grants panel per window, a shell-wide guard panel with the event log, the provider picker, and the offline preview behind `?preview=1` ([D-011](./decisions.md#d-011)), hosted at [kernlize.github.io/app/?preview=1](https://kernlize.github.io/app/?preview=1). |

"Works" means the behaviour has a scenario in `packages/*/features/`, the scenario passes, and the page describing it exists. It does not mean the API is stable. Every package is `0.1.0`; on 0.x a breaking change is a minor bump.

## Messaging providers in the live shell

`createKernl` registers all three providers and, unless `KernlOptions.messagingBackends` overrides them, wires two real backends from `@kernl/core`: `createPrivateMessagesBackend` for `private` (NIP-17 gift-wrapped messages) and `createLegacyMessagesBackend` for `legacy` (NIP-04 direct messages). Both sign and encrypt with the active account's signer and nothing else ([D-015](./decisions.md#d-015)). Availability follows the active account, and an unavailable provider reports a reason from `MESSAGING_UNAVAILABLE_REASONS`:

| Provider | Available when | Reason otherwise |
| --- | --- | --- |
| `private` | The active account's signer exposes `nip44` (browser extension, remote signer, password-protected local account) | `sign-in-required` with no active account; `signer-cannot-encrypt` when the signer has no `nip44` (a read-only account) |
| `legacy` | The active account's signer exposes `nip04` | `sign-in-required` with no active account; `signer-cannot-encrypt` when the signer has no `nip04` |
| `ratchet` | Never in this draft | `no-runtime`: a double-ratchet runtime has to be supplied |

`private` sends to the recipient's kind 10050 inbox relays, falling back to the sender's `outbox` and `super` tiers when the recipient publishes none, and wraps a copy to the sender so the conversation reads the same on every device. `legacy` is metadata-exposing: sender, recipient and timing are public on the event, and the picker says so. The Messages panel decrypts the user's own messages without a consent prompt, because the shell asks on the user's behalf; an applet reaches messages only through the `dm` domain grant. The preview still uses the in-memory backend.

## What does not work yet

- **In-shell transfer backends.** Downloads, sharing and mail work only by hand-off: `createKernl` passes `host.openLink` to `createDefaultBridges`, so the torrent, NZB, Soulseek and mail bridges open the locator's canonical address in an app on the user's device after the user confirms leaving kernl. kernl makes no connection for these; what the device app then does on its own network is outside kernl's view and control. No backend moves the data inside the shell, and there is no downloads view. A `job` result from a hand-off is an id, not a transfer kernl can track, and it is reported even when the user declines to leave. See [Bridges](./concepts/bridges.md#hand-off-backends).
- **Ratchet sessions.** No double-ratchet runtime ships, so `ratchet` reports `no-runtime` (the table above). See [Messaging](./concepts/messaging.md).
- **Web fetch from the browser shell, beyond the simple case.** The HTTP bridge runs in the page, so it is subject to CORS, and an opaque redirect it cannot inspect is refused with `denied:redirect-unverifiable`. Web fetch works from the shell for `https` origins that permit cross-origin reads and answer without a redirect. Hostnames are checked as literals only; no resolver is wired. See [Bridges](./concepts/bridges.md#the-http-bridge).
- **Per-host bridge consent.** `createKernl` builds the bridge registry with `createDefaultBridges()` and no `authorize` hook, so a `resource` request from a granted applet is checked by the HTTP bridge's SSRF policy and nothing else. A host that wants a prompt per host or scheme passes its own registry in `KernlOptions.bridges`.
- **Per-applet guard profiles.** `GuardFacade.setProfile` rebuilds the pipeline for the whole shell and is not persisted. The per-applet, remembered override [D-003](./decisions.md#d-003) describes is not in this draft.
- **Mobile layouts beyond the basics.** The layouts are desktop tilings over `@kehto/wm` ([Layouts](./concepts/layouts.md)). At 720 px wide and below the shell switches to a compact layout: every window fills the desktop, and the bar keeps **Open** and moves the guard, messages, layout, minimised windows, settings and sign-out into a **Menu** sheet; panels open as full-width sheets. There are no gestures.
- **Multi-account switching.** `AccountManager` holds several accounts and the sign-in panel lists them, but switching means signing out and in.
- **Grant persistence across devices.** Grants, relay tiers and messaging preferences persist in the host's storage only. There is no sync. Every key is listed in [Persistence](./concepts/persistence.md).
- **Packages on npm.** The `@kernl/*` packages are not published; they are used from a clone of the source repository, which is private during the alpha. See [Packages](./packages/index.md#install).
- **Source links in the API reference.** `typedoc.json` sets `packageOptions.disableSources: true`, so the generated reference has no "Defined in" source links. They would point at the source repository, which is private during the alpha.

The [Roadmap](./roadmap.md) orders this list.

## Upstream gaps

kernl composes kehto rather than forking it ([D-001](./decisions.md#d-001)). Four seams in kehto are narrower than kernl wants. All four are filed upstream against `kehto/web` rather than patched locally ([#397](https://github.com/kehto/web/issues/397), [#398](https://github.com/kehto/web/issues/398), [#399](https://github.com/kehto/web/issues/399), [#400](https://github.com/kehto/web/issues/400)). Each has a kernl layer that shrinks when it lands ([D-012](./decisions.md#d-012)):

1. **`ShellAdapter` does not forward `getFocusContext`, `onFirewallEvent` or `firewallPersistence` to the runtime.** Without `getFocusContext` the runtime firewall treats every window as focused. kernl runs its focus-aware firewall in `@kernl/guard`, in front of the bridge for the window-level `hello` and as an observer of port traffic, using the pure `evaluate()` engine with visibility supplied by the host; what it rejects on port traffic is refused before dispatch (gap 3). Because that layer never supplies `initElapsedMs`, kehto's init-burst guard does not fire there, and the guard config's `burstGuard` is unused. The runtime does supply it, so the runtime's own startup burst guard (kehto's default, 20 operations in the first 3 s, `block`) refuses before dispatch. Without `onFirewallEvent` the runtime's refusals reach the applet as `firewall:` errors but not the host, so the guard panel shows kernl's own count of the same rates. ([kehto/web#397](https://github.com/kehto/web/issues/397))
2. **`createRuntime` hardcodes the ACL default policy to `'permissive'`.** kernl produces its restrictive posture with `KernlGrants.ensure`, which writes an explicit grant or revoke for every capability of every applet it plans, plus `capabilities.resolveEnvironment`, which narrows the advertised domains to the baseline and the user's grants. The permissive default is never reached for an applet kernl runs. ([kehto/web#398](https://github.com/kehto/web/issues/398))
3. **There is no hook that can hold or delay port traffic.** kehto calls `onNappletMessage` synchronously before it dispatches each envelope, but ignores its answer. kernl closes the refusal half of this gap itself: whenever its ingress guard, focus firewall or hidden-window check will not let an envelope through (a size cap, a burst above the per-second rate, the smaller unfocused budget, or a non-control request from a window that is not visible), it sets the applet's runtime policy to `deny` for that one synchronous dispatch (`refuseCurrentDispatch`), so kehto refuses the envelope with a `firewall:` error. Quarantine revokes the binding inside the hook, so kehto finds no session and drops the envelope that crossed the limit. Control envelopes are never refused. What remains is the gentler half: a hidden window's requests are refused, and the applet must retry once visible, where a hook that let the shell defer them would hold them instead. See [Guard](./concepts/guard.md#where-enforcement-happens). ([kehto/web#399](https://github.com/kehto/web/issues/399))
4. **The runtime firewall never applies an unfocused multiplier.** Because of gap 1 the runtime sees every window as focused, so its multiplier, whatever the value, never applies; and `FirewallStateContainer` has no setter for `unfocusedMultiplier`, so kernl could not install the profile's value even if focus were forwarded. The profile's value is applied only by kernl's focus firewall, whose overruns kernl refuses through `refuseCurrentDispatch`. ([kehto/web#400](https://github.com/kehto/web/issues/400))

A fifth observation, not a gap kernl needs closed: the transport internals `createNip5dTransport` and `createShellReadyState` are not exported, so kernl uses `createShellBridge` unchanged.

One mitigation goes beyond kehto: `@kehto/shell` 0.30.0 ships `experimental.nestedContextLock`, which stops an applet creating a child frame whose fresh realm still has WebRTC, and `planMount` always enables it. kehto's lock guards creation only, and four creation routes get past it (a customized built-in constructed with `new`, XSLT, and a namespace-prefixed XHTML element brought in with `importNode` or `adoptNode`), so `@kernl/guard` adds an insertion lock on top until kehto guards insertion. The routes are to be reported to kehto ([D-014](./decisions.md#d-014)).

## Corrections

- **Rate enforcement (corrected 2026-11-03).** Earlier drafts of these docs, the README and D-012 said kehto's runtime firewall refused envelopes over the profile's rates. It did not: `applyRuntimeFirewallRules` also set each applet's runtime policy to `allow`, and kehto's `evaluate()` returns `pass` for an `allow` policy before it looks at any rate, matcher or burst. No rate was refused before dispatch; only kernl's reports and quarantine applied. The policy call is removed, the rates and kehto's startup burst guard now refuse before dispatch, and D-012 is rewritten to match.
- **Size caps (corrected 2026-11-03).** The guard's size matchers were described as able to report `matcher:size:<class>` in the shell. They cannot fire there: the ingress guard rejects the same envelopes first. Oversized downloads and queries were reported but still handled; they are now refused before dispatch.
- **Focus tightening, bursts and hidden windows (changed 2026-11-04).** These were reported to the user but still handled. They are now refused before dispatch the same way size caps are (`refuseCurrentDispatch`): a request over the smaller unfocused budget, a request in a burst above the per-second rate, and any non-control request from a hidden window get a `firewall:` error. Control envelopes are never refused. See [D-012](./decisions.md#d-012).

## Versions this draft is built against

| Dependency | Range |
| --- | --- |
| `@kehto/acl` | `^0.20.2` |
| `@kehto/firewall` | `^0.6.3` |
| `@kehto/runtime` | `^0.27.2` |
| `@kehto/shell` | `^0.30.0` |
| `@kehto/services` | `^0.29.0` |
| `@kehto/nip` | `^0.8.0` |
| `@kehto/wm` | `^0.0.2` |
| `applesauce-*` | `^7.0.x` |
| `@napplet/core` | `>=0.37.0 <0.38.0` |

The protocol itself is a draft. NIP-5D is [nostr-protocol/nips PR #2303](https://github.com/nostr-protocol/nips/pull/2303) and the NAP documents live at [napplet/naps](https://github.com/napplet/naps). kernl keeps no local copy of either; see [Spec conformance](./policies/spec-conformance.md).
