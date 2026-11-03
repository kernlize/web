# Alpha status

kernl is a first draft. This page says what runs, what is a contract without an implementation, and which gaps have been filed against upstream. It is updated in the same pull request as the code it describes.

## What works

| Area | Package | State |
| --- | --- | --- |
| Guard | `@kernl/guard` | Three profiles (`createGuardConfig`, `applyNappletRules`), envelope classification, ingress flood control with quarantine, visibility gate, focus-aware firewall over `@kehto/firewall`'s `evaluate()`, the fixed zero-network CSP, eleven mitigation descriptions for the UI. Pure, fully specified in `packages/guard/features/`. |
| Messaging | `@kernl/messaging` | `MessagingProvider`, `MessagingBackend`, `MessagingRegistry` with saved-preference restore, the composite backend with `provider:innerId` namespacing, `describeProvider` rows, a complete in-memory backend (`createMemoryBackend`) used by the preview and the tests, and three providers (`private`, `legacy`, `ratchet`) built with `defineProvider` from backends the shell injects. |
| Bridges | `@kernl/bridges` | `Locator` parsing for the web schemes, `magnet:`, `nzb:`, `slsk:` and `mailto:`, the `Bridge` contract, the registry with its consent hook and outcome events, a complete HTTP bridge with SSRF policy, the four backend-driven bridges up to their backend interface, `createBridgeResourceResolver` for kehto's resource service, and `describeBridge` rows. |
| Composition | `@kernl/core` | `createKernl` over one applesauce `EventStore`, `RelayPool` and `AccountManager`; applet resolution and mount planning through `@kehto/nip/5d` and `@kehto/shell`; consent summaries; layouts. |
| Shell UI | `apps/web` | Landing site at `/` and the shell at `/app/`: sign-in, open by address, windows, grants panel, provider picker. |

"Works" means the behaviour has a scenario in `features/`, the scenario passes, and the page describing it exists. It does not mean the API is stable. Every package is `0.1.0`; on 0.x a breaking change is a minor bump.

## What does not work yet

- **Transfer backends.** `TorrentBackend`, `NzbBackend`, `SoulseekBackend` and `MailBackend` are interfaces. Without a backend the corresponding bridge reports `{ available: false, reason: 'no-backend' }`, rejects with `unavailable:no-backend`, and the shell shows that. See [Bridges](./concepts/bridges.md#backend-driven-bridges).
- **Real messaging backends.** `@kernl/messaging` ships the contract, the registry, the composite and an in-memory backend. The relay-backed backends for `private`, `legacy` and `ratchet` are the shell's to inject through `ProviderDeps`; the `ratchet` provider in particular reports whatever reason the shell gives (for example `no-ratchet-runtime`) until a double-ratchet runtime is supplied. See [Messaging](./concepts/messaging.md).
- **Mobile layouts.** The window manager has desktop layouts only. Narrow viewports get a single stacked window without gestures.
- **Multi-account switching.** `AccountManager` holds several accounts, but the UI exposes one active account and no switcher. Switching means signing out and in.
- **Guard persistence across devices.** Per-applet profile overrides and grants persist locally. There is no sync.
- **Source links in the API reference.** TypeDoc source links point at the repository only once a git remote is configured in the build environment.

The [Roadmap](./roadmap.md) orders this list.

## Upstream gaps

kernl composes kehto rather than forking it ([D-001](https://github.com/kernlize/web/blob/main/DECISIONS.md)). Two seams in kehto are narrower than kernl wants, and both are filed against `kehto/web` rather than patched locally:

1. **`ShellAdapter` does not forward `getFocusContext`, `onFirewallEvent` or `firewallPersistence` to the runtime.** kernl runs its focus-aware firewall in `@kernl/guard`, in front of the bridge, using the pure `evaluate()` engine with focus supplied by kernl's window manager. Because that layer never supplies `initElapsedMs`, kehto's init-burst guard does not fire there; the per-second burst is the ingress guard's, and `createGuardConfig` sets `firewall.burstGuard` to match so a runtime firewall configured from the same object agrees.
2. **`createRuntime` hardcodes the ACL default policy to `'permissive'`.** kernl produces its restrictive posture with `capabilities.resolveEnvironment`, which narrows the advertised domains per applet identity until the user grants them, plus explicit `aclState.grant` calls. The permissive default is never reached for a domain the user has not granted.

A third observation, not a gap kernl needs closed: the transport internals `createNip5dTransport` and `createShellReadyState` are not exported, so kernl uses `createShellBridge` unchanged.

When either gap lands upstream, the corresponding kernl layer shrinks. Both layers sit behind interfaces in `@kernl/guard` and `@kernl/core`.

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
