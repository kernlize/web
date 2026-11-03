# Alpha status

kernl is a first draft. This page says what runs, what is a contract without an implementation, and which gaps have been filed against upstream. It is updated in the same pull request as the code it describes.

## What works

| Area | Package | State |
| --- | --- | --- |
| Guard | `@kernl/guard` | Three profiles (`createGuardConfig`, `applyNappletRules`), envelope classification, ingress flood control with quarantine, visibility gate, focus-aware firewall over `@kehto/firewall`'s `evaluate()`, the fixed zero-network CSP, eleven mitigation descriptions for the UI. Pure, fully specified in `packages/guard/features/`. |
| Messaging | `@kernl/messaging` | `MessagingProvider`, `MessagingBackend`, `MessagingRegistry` with saved-preference restore, the composite backend with `provider:innerId` namespacing, `describeProvider` rows, a complete in-memory backend (`createMemoryBackend`) used by the preview and the tests, and three providers (`private`, `legacy`, `ratchet`) built with `defineProvider` from backends the shell injects. |
| Bridges | `@kernl/bridges` | `Locator` parsing for the web schemes, `magnet:`, `nzb:`, `slsk:` and `mailto:`, the `Bridge` contract, the registry with its `authorize` hook and outcome events, a complete HTTP bridge with SSRF policy, the four backend-driven bridges up to their backend interface, `createBridgeResourceResolver` for kehto's resource service, and `describeBridge` rows. |
| Composition | `@kernl/core` | `createKernl` over one applesauce `EventStore`, `RelayPool` and `AccountManager`, with kehto's real `createShellBridge` exercised end to end in `kernl.feature`: an applet is decoded, resolved, planned and mounted, binds its port through the guarded `handleWindowMessage`, completes `shell.ready`, is answered by the theme, identity and resource services, and is quarantined and revoked when it floods. Relay tiers, the applesauce adapters, the guard pipeline and runtime firewall rules, grants over `bridge.runtime.aclState`, consent summaries, the default registries and the layouts each have their own feature file. |
| Shell UI | `apps/web` | Landing site at `/` and the shell at `/app/`: sign-in (browser extension, remote signer, read-only, password-protected local account), open by address with the required and optional domains as choices, windows, a grants panel per window, a shell-wide guard panel with the event log, the provider picker, and the offline preview behind `?preview=1` (D-011). |

"Works" means the behaviour has a scenario in `features/`, the scenario passes, and the page describing it exists. It does not mean the API is stable. Every package is `0.1.0`; on 0.x a breaking change is a minor bump.

## Messaging providers in the live shell

`createDefaultMessaging` registers all three providers, and each reports itself unavailable with a reason from `MESSAGING_UNAVAILABLE_REASONS` until the host passes a backend factory in `KernlOptions.messagingBackends`:

| Provider | Reason | What is missing |
| --- | --- | --- |
| `private` | `needs-local-key-signer` | kehto's sealed-message adapter wants the owner's raw secret key, which kernl never holds outside an applesauce signer. A backend built from a signer the host controls makes it available. |
| `legacy` | `not-implemented` | No backend exists for the original direct-message format. |
| `ratchet` | `no-runtime` | A double-ratchet runtime has to be supplied. |

`apps/web` supplies none of them, so the live shell's provider picker shows all three greyed with these reasons. The preview uses the in-memory backend.

## What does not work yet

- **Transfer backends.** `TorrentBackend`, `NzbBackend`, `SoulseekBackend` and `MailBackend` are interfaces. Without a backend the corresponding bridge reports `{ available: false, reason: 'no-backend' }`, rejects with `unavailable:no-backend`, and the shell shows that. See [Bridges](./concepts/bridges.md#backend-driven-bridges).
- **Real messaging backends.** The table above. See [Messaging](./concepts/messaging.md).
- **Per-host bridge consent.** `createKernl` builds the bridge registry with `createDefaultBridges()` and no `authorize` hook, so a `resource` request from a granted applet is checked by the HTTP bridge's SSRF policy and nothing else. A host that wants a prompt per host or scheme passes its own registry in `KernlOptions.bridges`.
- **Per-applet guard profiles.** `GuardFacade.setProfile` rebuilds the pipeline for the whole shell and is not persisted. The per-applet, remembered override D-003 describes is not in this draft.
- **Mobile layouts.** The layouts are desktop tilings over `@kehto/wm`. Narrow viewports get a single stacked window without gestures.
- **Multi-account switching.** `AccountManager` holds several accounts and the sign-in panel lists them, but switching means signing out and in.
- **Grant persistence across devices.** Grants, relay tiers and messaging preferences persist in the host's storage only. There is no sync.
- **Source links in the API reference.** TypeDoc source links point at the repository only once a git remote is configured in the build environment.

The [Roadmap](./roadmap.md) orders this list.

## Upstream gaps

kernl composes kehto rather than forking it ([D-001](https://github.com/kernlize/web/blob/main/DECISIONS.md)). Four seams in kehto are narrower than kernl wants. All four are filed against `kehto/web` rather than patched locally, and each has a kernl layer that shrinks when it lands (D-012):

1. **`ShellAdapter` does not forward `getFocusContext`, `onFirewallEvent` or `firewallPersistence` to the runtime.** kernl runs its focus-aware firewall in `@kernl/guard`, in front of the bridge for the window-level `hello` and reactively for port traffic, using the pure `evaluate()` engine with visibility supplied by the host. Because that layer never supplies `initElapsedMs`, kehto's init-burst guard does not fire there; the per-second burst is the ingress guard's, and `createGuardConfig` sets `firewall.burstGuard` to match.
2. **`createRuntime` hardcodes the ACL default policy to `'permissive'`.** kernl produces its restrictive posture with `KernlGrants.ensure`, which writes an explicit grant or revoke for every capability of every applet it plans, plus `capabilities.resolveEnvironment`, which narrows the advertised domains to the baseline and the user's grants. The permissive default is never reached for an applet kernl runs.
3. **There is no pre-dispatch hook on port traffic.** `onNappletMessage` is observe-only, so kernl's ingress guard, visibility gate and focus firewall see a port envelope after the runtime dispatched it. Pre-dispatch limits come from the runtime's own firewall, configured through `applyRuntimeFirewallRules`; deferral while hidden is advisory for port traffic. See [Guard](./concepts/guard.md#where-enforcement-happens).
4. **`FirewallStateContainer` has no setter for `unfocusedMultiplier`.** The runtime firewall applies kehto's default multiplier before dispatch; the profile's value is applied only by kernl's reactive focus firewall.

A fifth observation, not a gap kernl needs closed: the transport internals `createNip5dTransport` and `createShellReadyState` are not exported, so kernl uses `createShellBridge` unchanged.

## Versions this draft is built against

| Dependency | Range |
| --- | --- |
| `@kehto/acl` | `^0.20.2` |
| `@kehto/firewall` | `^0.6.3` |
| `@kehto/runtime` | `^0.27.2` |
| `@kehto/shell` | `^0.29.0` |
| `@kehto/services` | `^0.29.0` |
| `@kehto/nip` | `^0.8.0` |
| `@kehto/wm` | `^0.0.2` |
| `applesauce-*` | `^7.0.x` |
| `@napplet/core` | `>=0.37.0 <0.38.0` |

The protocol itself is a draft. NIP-5D is [nostr-protocol/nips PR #2303](https://github.com/nostr-protocol/nips/pull/2303) and the NAP documents live at [napplet/naps](https://github.com/napplet/naps). kernl keeps no local copy of either; see [Spec conformance](./policies/spec-conformance.md).
