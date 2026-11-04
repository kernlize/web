# Changelog

Each entry says what ships, per package and app. [Alpha status](./alpha-status.md) is the current picture; this page is the history. Versions follow semver on 0.x: a breaking change is a minor bump.

## Unreleased

### `@kernl/core`

- `createPrivateMessagesBackend`: NIP-17 messages over the account signer. The seal is signed by the account with `nip44`; the wrap is signed by an ephemeral key that lives inside an applesauce `PrivateKeySigner` and is discarded after the wrap. Sends go to the recipient's kind 10050 inbox relays, falling back to the user's `outbox` and `super` tiers, with a copy wrapped to the user ([D-015](./decisions.md#d-015)).
- `createLegacyMessagesBackend`: NIP-04 kind 4 messages through `signer.nip04`, normalised the same way and still marked metadata-exposing.
- `createKernl` wires both by default unless `KernlOptions.messagingBackends` overrides them, so `private` and `legacy` work in the live shell. Availability follows the active account: `private` needs a signer with `nip44`, `legacy` one with `nip04`.
- **Breaking.** `MESSAGING_UNAVAILABLE_REASONS` now holds `sign-in-required`, `signer-cannot-encrypt` and `no-runtime`. `needs-local-key-signer` and `not-implemented` are removed. See [Error reasons](./reference/errors.md).
- **Breaking.** `planMount` enables kehto's released nested-context lock, `experimental: { nestedContextLock: true }` from `@kehto/shell` 0.30.0, in place of kernl's port of it. kehto now renders the Trusted Types directives, installs the `default` policy and pins the element factories; its `assertNappletHasNoFrame` still maps to `denied:nested-frame`. Frame creation inside an applet now throws `TypeError('kehto: napplets may not create nested browsing contexts')`; insertion still throws `denied:nested-frame` ([D-014](./decisions.md#d-014)).
- `@kehto/shell` is now `^0.30.0`. The other kehto packages are unchanged.

### `@kernl/guard`

- `renderFrameLockScript` is renamed `renderInsertionLockScript` and emits `<script data-kernl-insertion-lock>`, which applies only the insertion lock: the DOM insertion pins, the refusal of custom elements that extend frame elements, and the removal of `XSLTProcessor`. kehto's lock guards creation only, so the insertion lock stays until kehto guards insertion; the four routes past kehto's lock are to be reported upstream.
- **Breaking.** Removed `appletMarkupHasFrame`, `assertAppletHasNoFrame`, `TRUSTED_TYPES_DIRECTIVES` and the `trustedTypes` field of `AppletCsp`. `createAppletCsp` returns the 14 baseline directives only, and `@kernl/guard` no longer throws outside the applet realm.

### Shell and site (`apps/web`)

- The Messages panel sends and receives private and legacy messages for an account whose signer can encrypt (browser extension, remote signer, password-protected local account). It opens the user's own messages without a consent prompt; applets still reach messages only through the `dm` grant.

## 0.1.0 — first draft, 2026-11-03

The first version of every package and of the shell. Nothing is published to npm yet; the packages are used from the source repository, which is private during the alpha ([Packages](./packages/index.md#install)).

### `@kernl/guard` 0.1.0

- Three profiles, `strict`, `balanced` and `relaxed`, from `createGuardConfig`, and `applyNappletRules` for kehto's runtime firewall.
- Envelope classification, ingress flood control with quarantine, the visibility gate, and the focus-aware firewall over `@kehto/firewall`'s `evaluate()`.
- The fixed zero-network CSP from `createAppletCsp`, with the Trusted Types directives the frame lock needs.
- The nested-frame lock: a port of kehto's unreleased `experimental.nestedContextLock` ([D-014](./decisions.md#d-014)), described under Security below.
- Eleven mitigation descriptions for the guard panel. Pure; its one dependency is `@kehto/firewall`. See [`@kernl/guard`](./packages/guard.md).

### `@kernl/messaging` 0.1.0

- The `MessagingProvider`, `MessagingBackend` and `MessagingRegistry` contracts, with saved-preference restore.
- The composite backend with `provider:innerId` namespacing, and `describeProvider` rows.
- A complete in-memory backend, `createMemoryBackend`, used by the preview and the tests.
- Three providers, `private`, `legacy` and `ratchet`, built with `defineProvider` from backends the host injects. No real backend ships, so all three are unavailable in the live shell. See [`@kernl/messaging`](./packages/messaging.md).

### `@kernl/bridges` 0.1.0

- `parseLocator` for the web schemes, `magnet:`, `nzb:`, `slsk:` and `mailto:`, with `formatLocator` and `isNzbUrl`.
- The `Bridge` contract, the registry with its `authorize` hook and outcome events, and `describeBridge` rows.
- A complete HTTP bridge with an SSRF policy: `https` only, private and local destinations blocked, a byte limit on the streamed body, and opaque redirects refused in the browser.
- The torrent, NZB, Soulseek and mail bridges, and `createHandoffBackends`, which serves all four by opening the locator's canonical address in an app on the user's device ([Bridges](./concepts/bridges.md#hand-off-backends)).
- `createBridgeResourceResolver` for kehto's resource service. See [`@kernl/bridges`](./packages/bridges.md).

### `@kernl/core` 0.1.0

- `createKernl`, the composition root: one applesauce `EventStore`, `RelayPool` and `AccountManager` over kehto's `createShellBridge`, exercised end to end in `kernl.feature`.
- Applet pointer decoding, manifest resolution, the mount plan and mounting.
- Grants over `bridge.runtime.aclState`, the restrictive environment resolver, and consent summaries for destructive writes.
- [Relay tiers](./concepts/relay-tiers.md), [persistence](./concepts/persistence.md) under the `kernl:` prefix with plaintext keys refused, the guard pipeline and runtime firewall rules, the default messaging and bridge registries, and four [layouts](./concepts/layouts.md). See [`@kernl/core`](./packages/core.md).

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
