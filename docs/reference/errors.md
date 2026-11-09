# Error reasons

Every failure in the four packages carries a stable reason string with a prefix that says what kind of failure it is. Code matches on the string; the UI maps it to words. This page lists each reason the packages throw or report, collected from `packages/*/src`.

| Prefix | Means |
| --- | --- |
| `denied:` | A policy or the user said no. Retrying the same request will not help. |
| `invalid:` | The input is malformed or names something that does not exist. |
| `unavailable:` | Something needed is missing or unreachable right now: a backend, a server, a provider. |

Thrown reasons are the `message` of an `Error`. A few carry a detail after a space (`denied:scheme http:`), so match on the part before the first space.

## Thrown errors

| Reason | Package | Thrown by | Meaning |
| --- | --- | --- | --- |
| `invalid:pointer` | `@kernlize/core` | `decodePointer` | The input is not, and does not contain, an `naddr`, `nevent`, `note`, 64-hex event id or coordinate. |
| `unavailable:manifest` | `@kernlize/core` | `fetchManifestEvent`, so `Kernl.resolve` | A relay answered, in the hints, the `apps` tier or the `super` tier, and none returned the manifest event; or there was no usable relay to ask. |
| `unavailable:network` | `@kernlize/core` | `fetchManifestEvent`, so `Kernl.resolve` | No relay answered in either round: every one failed, or none answered within `MANIFEST_TIMING.timeoutMs`. The applet may well exist. |
| `unavailable:blob` | `@kernlize/core` | `defaultFetchBlob`, `resolveApplet` | No server returned the artifact bytes. kehto's `blob-unavailable` maps here. |
| `invalid:invalid-signature`, `invalid:invalid-manifest`, `invalid:aggregate-mismatch`, `invalid:blob-hash-mismatch`, `invalid:missing-index` | `@kernlize/core` | `resolveApplet` | Verification failed. The part after `invalid:` is kehto's `NappletResolutionErrorCode`. Nothing runs. |
| `invalid:unresolved` | `@kernlize/core` | `Kernl.plan`, `Kernl.install` | The summary was not produced by this shell's `resolve`, so no verified bytes are held for it and it cannot be run or installed. |
| `unavailable:handler`, `unavailable:window`, `unavailable:delivery` | `@kernlize/core` | `createIntentDelivery`, after a request was accepted | The handler is no longer installed, the host did not open it, or it never held the receiving grant while delivery was retried. The asking applet was already told yes, so the user is told instead ([The store and intents](../concepts/store-and-intents.md)). |
| `denied:blocked` | `@kernlize/core` | `Kernl.plan` | The user blocked this applet identity. |
| `denied:nested-frame` | `@kernlize/core`, `@kernlize/guard` | `planMount`, so `Kernl.plan`; in the applet's realm, the insertion lock | kehto's `assertNappletHasNoFrame` found an `iframe`, `frame`, `frameset`, `object`, `embed`, `portal` or `fencedframe` element in the verified markup, so the applet is not mounted. Inside a running applet kernl's insertion lock throws it as a `TypeError` when applet code tries to connect a node that is or contains a frame element. A frame created by element factory or HTML string is refused earlier by kehto's nested-context lock, as `TypeError('kehto: napplets may not create nested browsing contexts')` ([D-014](../decisions.md#d-014)). |
| `unavailable:frame-lock` | `@kernlize/core` | `planMount`, so `Kernl.plan` | The srcdoc kehto prepared does not contain the CSP meta and namespace prelude where kernl expects them, so the insertion lock cannot be placed after kehto's lock and the applet is not mounted. Seen only with a kehto release whose output changed. |
| `invalid:frame-detached` | `@kernlize/core` | `mountApplet`, so `Kernl.mount` | The frame has no `contentWindow`; it is not in the document. |
| `invalid:domain` | `@kernlize/core` | `Grants.allowDomain` | The shell does not offer this domain in its current configuration. |
| `denied:baseline-domain` | `@kernlize/core` | `Grants.revokeDomain` | Baseline domains (`shell`, `inc`, `theme`, `storage`) cannot be revoked. |
| `denied:plaintext-key-persistence` | `@kernlize/core` | `KernlAccountManager.addAccount` | The account type stores a raw secret key (`PLAINTEXT_KEY_ACCOUNT_TYPES`). |
| `invalid:relay-url` | `@kernlize/core` | `RelayTiers.add` | The URL is not `ws://` or `wss://`. |
| `denied:read-only` | `@kernlize/core` | the outbox service's signer | The session cannot sign, so an outbox publish is refused. |
| `denied:consent` | `@kernlize/core` | `createSigningConsent`, through the window signer (`relay.publish`) or the outbox gate (`outbox.publish`) | An applet window asked to sign a destructive kind (any replaceable or addressable kind, 5 or 62) and the user denied or dismissed `host.presentConsent`. Nothing was signed or published. |
| `denied:unknown-applet` | `@kernlize/core` | `createSigningConsent` | A destructive write from a window the shell did not mount. |
| `denied:signed-out` | `@kernlize/core` | `createSigningConsent` | A destructive write (in practice an `outbox.publish`) while nobody is signed in. |
| `invalid:event-kind` | `@kernlize/core` | `createSigningConsent` | The event's `kind` is not a number. |
| `unavailable:sign-in-required` | `@kernlize/core` | `createDefaultMessaging`'s `createBackend`; `MessagingRegistry.enable` | `private` or `legacy` while no account is active (`MESSAGING_UNAVAILABLE_REASONS`). |
| `unavailable:signer-cannot-encrypt` | `@kernlize/core` | `createDefaultMessaging`'s `createBackend`; `MessagingRegistry.enable` | The active account's signer has no `nip44` (`private`) or no `nip04` (`legacy`); a read-only account is the usual case. |
| `unavailable:no-runtime` | `@kernlize/core` | `createDefaultMessaging`'s `createBackend`; `MessagingRegistry.enable` | `ratchet` registered by a host without a backend; `createKernl` always supplies one. |
| `invalid:duplicate-provider` | `@kernlize/messaging` | `MessagingRegistry.register` | A provider with this id is already registered. |
| `invalid:unknown-provider` | `@kernlize/messaging` | `MessagingRegistry.enable`, `disable`; the composite backend | No provider has this id, or a namespaced id, cursor or `provider` hint names no enabled provider. |
| `unavailable:<reason>` | `@kernlize/messaging` | `MessagingRegistry.enable` | The provider's `availability()` is false; `<reason>` is the bare word it reported. |
| `invalid:provider-not-enabled` | `@kernlize/messaging` | `MessagingRegistry.setDefault` | Only an enabled provider can be the default. |
| `unavailable:no-default-provider` | `@kernlize/messaging` | composite `send` | The request names no conversation and no provider, and there is no enabled default. |
| `invalid:no-recipients`, `invalid:unknown-conversation`, `unavailable:offline` | `@kernlize/messaging` | `createMemoryBackend` `send` | No recipient besides the owner; a `conversationId` the backend does not hold; the backend was created with `available: false`. |
| `invalid:recipient`, `invalid:groups-unsupported`, `unavailable:offline` | `@kernlize/core` | `createPrivateMessagesBackend`, `createLegacyMessagesBackend` `send` | The recipient is not a public key; the legacy backend got more than one correspondent; no relay accepted the message. |
| `invalid:locator` | `@kernlize/bridges` | `parseLocator` | Not a locator, or a malformed web, NZB, Soulseek or mail locator. |
| `invalid:magnet-missing-hash` | `@kernlize/bridges` | `parseLocator` | A magnet without a `urn:btih:` hash. |
| `invalid:locator-missing-<field>` | `@kernlize/bridges` | the torrent, NZB, Soulseek and mail bridges | The locator lacks `infoHash`, `url`, `user`, `path` or `address`. |
| `invalid:nzb-not-https` | `@kernlize/bridges` | the NZB backend from `createHandoffBackends` | The NZB document is not served over `https`, so it is not handed off and nothing is opened. |
| `invalid:duplicate-bridge <id>`, `invalid:scheme-taken <scheme>` | `@kernlize/bridges` | `BridgeRegistry.register` | A bridge with this id, or one serving this scheme, is already registered. |
| `unavailable:no-bridge` | `@kernlize/bridges` | `BridgeRegistry.resolve` | No bridge serves the scheme. |
| `unavailable:no-backend` | `@kernlize/bridges` | the four backend-driven bridges | The bridge was created without a backend. `availability().reason` is the bare `no-backend`. In the composed shell the four have hand-off backends; a registry built from `createDefaultBridges()` without a `handoff` opener reports this. |
| `denied:bridge` | `@kernlize/bridges` | `BridgeRegistry.resolve` | The registry's `authorize` hook returned false. The composed shell has none. |
| `denied:scheme <protocol>` | `@kernlize/bridges` | HTTP bridge | The URL's scheme is not in `allowedSchemes`. |
| `denied:private-address <host>`, `denied:private-address <host> -> <ip>` | `@kernlize/bridges` | HTTP bridge | The host is a blocked name or a private literal; the second form comes from a `resolveHost` result. |
| `denied:too-many-redirects` | `@kernlize/bridges` | HTTP bridge | More than `maxRedirects` hops. |
| `denied:redirect-unverifiable` | `@kernlize/bridges` | HTTP bridge | In a browser, `fetch` with `redirect: 'manual'` returns an opaque redirect whose target the bridge cannot read, so it cannot re-check the next hop and refuses. In Node and on servers redirects are followed and checked. |
| `invalid:redirect` | `@kernlize/bridges` | HTTP bridge | A redirect without a usable `Location`. |
| `denied:too-large` | `@kernlize/bridges` | HTTP bridge | `content-length` or the streamed body exceeds `maxBytes`. |
| `unavailable:timeout`, `unavailable:aborted`, `unavailable:network <message>` | `@kernlize/bridges` | HTTP bridge | The time limit expired, the caller cancelled, or `fetch` failed for another reason. In a browser a CORS refusal and a network failure are the same `TypeError`, so both surface as `unavailable:network Failed to fetch`. |
| `unavailable:network <type> response` | `@kernlize/bridges` | HTTP bridge | Any status-0 answer other than an opaque redirect, for example `unavailable:network opaque response`. |

`@kernlize/guard` throws nothing outside the applet realm. Its decisions are events.

## Guard event reasons

The guard reports each non-pass decision as a `GuardEvent` with a `disposition` (`defer`, `reject`, `quarantine`, `flag`) and one of these reasons. They reach the user through `kernl.guard.events$` and the shell's guard panel. The numbers are per profile; see [Guard](../concepts/guard.md#profiles).

For an applet's port traffic these layers decide each envelope through kehto's `filterNappletMessage` before the runtime sees it ([D-020](../decisions.md#d-020)). A `reject` drops the envelope, and the applet gets no reply. A `defer` with reason `hidden:<class>` holds it until the window is visible; a `flood:burst` `defer` on port traffic drops it. A `quarantine` revokes the binding, which also stops the envelope that crossed the limit and discards what the window held. For the window-level `hello`, `defer` and `reject` hold or drop it.

kehto's runtime firewall refuses what it handles over the per-class rates, the unfocused budget or the startup burst with an error whose message starts `firewall:`, and reports each refusal through `onFirewallEvent`; kernl turns those into guard events with the reasons in the last three rows, without the applet's message.

| Reason | Emitted by | Disposition | Meaning |
| --- | --- | --- | --- |
| `flood:burst` | ingress guard (`ingress-guard.ts`) | `defer` | More messages in one second than `ingressBurst` allows. A `hello` is held; a port envelope other than a control one is dropped. |
| `flood:queue-full` | ingress guard | `reject` | More than `ingressQueue` messages over the burst. A `hello` is dropped; a port envelope other than a control one is dropped. |
| `flood:quarantine` | ingress guard | `quarantine` | `quarantineThreshold` messages in a rolling 10 s, or any message from a window already quarantined. The binding is revoked. |
| `flood:hidden-resource` | ingress guard | `quarantine` | A hidden window made more `resource.*` requests than `hiddenResourceAllowance`. The binding is revoked. |
| `size:<class>` | ingress guard | `reject` | The envelope is over the size cap for `resource:bytes`, `relay:subscribe` or `outbox:subscribe`. In the composed shell the envelope is dropped before dispatch: nothing is fetched and the applet gets no reply. |
| `hidden:<class>` | guard pipeline (`pipeline.ts`) | `defer` | A non-control port envelope from a window that is not visible. It is held and handled once the window is visible. |
| `defer:queue-full` | visibility gate (`visibility-gate.ts`) | `reject` | The hidden window already holds `deferQueue` envelopes; this one is dropped. |
| `rate:<class>` | focus firewall (`focus-firewall.ts`), or the runtime firewall through `onFirewallEvent` | `reject`, or `flag` when the rate's action is `flag` | kehto's `rate:opclass`, `rate:global` or `rate:default` rule fired; the reason names the class, for example `rate:relay:publish`. From the focus firewall the envelope is dropped; from the runtime it is refused with a `firewall:` error. |
| `matcher:<id>` | focus firewall | `reject` | A kehto content matcher fired; the rule id is passed through unchanged. The guard's own matchers are `size:resource:bytes`, `size:relay:subscribe` and `size:outbox:subscribe`, and in the composed shell they cannot fire: the ingress guard rejects the same envelopes with `size:<class>` first, and the focus firewall sees only what it passed. A caller that runs the focus firewall alone can see `matcher:size:<class>`. |
| `policy:deny` | focus firewall | `reject` | The applet's policy in the guard's own firewall configuration is `deny`. kernl sets no policy there, so this appears only if a caller set one. |
| `prompt:<ruleId>` | focus firewall | `reject` | kehto's engine asked for a prompt (for example `prompt:policy:ask`); the guard has no UI and treats it as a rejection. |
| `flood:startup` | runtime firewall, through `onFirewallEvent` | `reject` | More operations in a window's first second than the profile's `ingressBurst`; the runtime refuses the excess with a `firewall:` error. |
| `runtime:<ruleId>` | runtime firewall, through `onFirewallEvent` | `reject`, or `flag` when it passed with a flag | Any other runtime firewall decision, with kehto's rule id, for example `runtime:policy:deny`. |

## Revocation reasons

`KernlHost.onRevoked(windowId, reason)` receives kehto's revocation reasons (`window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed`, `deferred-overflow`, `host`) or `quarantine` when the guard quarantined the window. See [Architecture](../concepts/architecture.md#the-mount-path).

## Related

- [API reference](./api.md): each function's JSDoc names the reasons it throws.
- [Troubleshooting](../guides/troubleshooting.md)
