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
| `invalid:pointer` | `@kernl/core` | `decodePointer` | The input is not an `naddr`, `nevent`, `note`, 64-hex event id or coordinate. |
| `unavailable:manifest` | `@kernl/core` | `fetchManifestEvent`, so `Kernl.resolve` | No relay in the hints or the `apps` tier returned the manifest event. |
| `unavailable:blob` | `@kernl/core` | `defaultFetchBlob`, `resolveApplet` | No server returned the artifact bytes. kehto's `blob-unavailable` maps here. |
| `invalid:invalid-signature`, `invalid:invalid-manifest`, `invalid:aggregate-mismatch`, `invalid:blob-hash-mismatch`, `invalid:missing-index` | `@kernl/core` | `resolveApplet` | Verification failed. The part after `invalid:` is kehto's `NappletResolutionErrorCode`. Nothing runs. |
| `invalid:unresolved` | `@kernl/core` | `Kernl.plan` | The summary was not produced by this shell's `resolve`, so no verified bytes are held for it. |
| `denied:blocked` | `@kernl/core` | `Kernl.plan` | The user blocked this applet identity. |
| `invalid:frame-detached` | `@kernl/core` | `mountApplet`, so `Kernl.mount` | The frame has no `contentWindow`; it is not in the document. |
| `invalid:domain` | `@kernl/core` | `Grants.allowDomain` | The shell does not offer this domain in its current configuration. |
| `denied:baseline-domain` | `@kernl/core` | `Grants.revokeDomain` | Baseline domains (`shell`, `inc`, `theme`, `identity`, `storage`) cannot be revoked. |
| `denied:plaintext-key-persistence` | `@kernl/core` | `KernlAccountManager.addAccount` | The account type stores a raw secret key (`PLAINTEXT_KEY_ACCOUNT_TYPES`). |
| `invalid:relay-url` | `@kernl/core` | `RelayTiers.add` | The URL is not `ws://` or `wss://`. |
| `denied:read-only` | `@kernl/core` | the outbox service's signer | The session cannot sign, so an outbox publish is refused. |
| `denied:consent` | `@kernl/core` | `createSigningConsent`, through the window signer (`relay.publish`) or the outbox gate (`outbox.publish`) | An applet window asked to sign a destructive kind (0, 3, 5, 10002, the list kinds) and the user denied or dismissed `host.presentConsent`. Nothing was signed or published. |
| `denied:unknown-applet` | `@kernl/core` | `createSigningConsent` | A destructive write from a window the shell did not mount. |
| `denied:signed-out` | `@kernl/core` | `createSigningConsent` | A destructive write (in practice an `outbox.publish`) while nobody is signed in. |
| `invalid:event-kind` | `@kernl/core` | `createSigningConsent` | The event's `kind` is not a number. |
| `unavailable:needs-local-key-signer`, `unavailable:not-implemented`, `unavailable:no-runtime` | `@kernl/core` | `createDefaultMessaging`'s `createBackend`; `MessagingRegistry.enable` | The host supplied no backend for `private`, `legacy` or `ratchet` (`MESSAGING_UNAVAILABLE_REASONS`). |
| `invalid:duplicate-provider` | `@kernl/messaging` | `MessagingRegistry.register` | A provider with this id is already registered. |
| `invalid:unknown-provider` | `@kernl/messaging` | `MessagingRegistry.enable`, `disable`; the composite backend | No provider has this id, or a namespaced id, cursor or `provider` hint names no enabled provider. |
| `unavailable:<reason>` | `@kernl/messaging` | `MessagingRegistry.enable` | The provider's `availability()` is false; `<reason>` is the bare word it reported. |
| `invalid:provider-not-enabled` | `@kernl/messaging` | `MessagingRegistry.setDefault` | Only an enabled provider can be the default. |
| `unavailable:no-default-provider` | `@kernl/messaging` | composite `send` | The request names no conversation and no provider, and there is no enabled default. |
| `invalid:no-recipients`, `invalid:unknown-conversation`, `unavailable:offline` | `@kernl/messaging` | `createMemoryBackend` `send` | No recipient besides the owner; a `conversationId` the backend does not hold; the backend was created with `available: false`. |
| `invalid:locator` | `@kernl/bridges` | `parseLocator` | Not a locator, or a malformed web, NZB, Soulseek or mail locator. |
| `invalid:magnet-missing-hash` | `@kernl/bridges` | `parseLocator` | A magnet without a `urn:btih:` hash. |
| `invalid:locator-missing-<field>` | `@kernl/bridges` | the torrent, NZB, Soulseek and mail bridges | The locator lacks `infoHash`, `url`, `user`, `path` or `address`. |
| `invalid:duplicate-bridge <id>`, `invalid:scheme-taken <scheme>` | `@kernl/bridges` | `BridgeRegistry.register` | A bridge with this id, or one serving this scheme, is already registered. |
| `unavailable:no-bridge` | `@kernl/bridges` | `BridgeRegistry.resolve` | No bridge serves the scheme. |
| `unavailable:no-backend` | `@kernl/bridges` | the four backend-driven bridges | The bridge was created without a backend. `availability().reason` is the bare `no-backend`. |
| `denied:bridge` | `@kernl/bridges` | `BridgeRegistry.resolve` | The registry's `authorize` hook returned false. The composed shell has none. |
| `denied:scheme <protocol>` | `@kernl/bridges` | HTTP bridge | The URL's scheme is not in `allowedSchemes`. |
| `denied:private-address <host>`, `denied:private-address <host> -> <ip>` | `@kernl/bridges` | HTTP bridge | The host is a blocked name or a private literal; the second form comes from a `resolveHost` result. |
| `denied:too-many-redirects` | `@kernl/bridges` | HTTP bridge | More than `maxRedirects` hops. |
| `denied:redirect-unverifiable` | `@kernl/bridges` | HTTP bridge | In a browser, `fetch` with `redirect: 'manual'` returns an opaque redirect whose target the bridge cannot read, so it cannot re-check the next hop and refuses. In Node and on servers redirects are followed and checked. |
| `invalid:redirect` | `@kernl/bridges` | HTTP bridge | A redirect without a usable `Location`. |
| `denied:too-large` | `@kernl/bridges` | HTTP bridge | `content-length` or the streamed body exceeds `maxBytes`. |
| `unavailable:timeout`, `unavailable:aborted`, `unavailable:network <message>` | `@kernl/bridges` | HTTP bridge | The time limit expired, the caller cancelled, or `fetch` failed for another reason. In a browser a CORS refusal and a network failure are the same `TypeError`, so both surface as `unavailable:network Failed to fetch`. |
| `unavailable:network <type> response` | `@kernl/bridges` | HTTP bridge | Any status-0 answer other than an opaque redirect, for example `unavailable:network opaque response`. |

`@kernl/guard` throws nothing. Its decisions are events.

## Guard event reasons

The guard reports each non-pass decision as a `GuardEvent` with a `disposition` (`defer`, `reject`, `quarantine`, `flag`) and one of these reasons. They reach the user through `kernl.guard.events$` and the shell's guard panel. The numbers are per profile; see [Guard](../concepts/guard.md#profiles).

For an applet's port traffic these layers run after kehto dispatched the envelope ([D-012](../decisions.md#d-012)): an event records what happened, and only a `quarantine` changes anything, by revoking the binding. `defer` and `reject` hold or drop only the window-level `hello`.

| Reason | Emitted by | Disposition | Meaning |
| --- | --- | --- | --- |
| `flood:burst` | ingress guard (`ingress-guard.ts`) | `defer` | More messages in one second than `ingressBurst` allows. A `hello` is held; for port traffic this is a report. |
| `flood:queue-full` | ingress guard | `reject` | More than `ingressQueue` messages over the burst. A `hello` is dropped; for port traffic this is a report. |
| `flood:quarantine` | ingress guard | `quarantine` | `quarantineThreshold` messages in a rolling 10 s, or any message from a window already quarantined. The binding is revoked. |
| `flood:hidden-resource` | ingress guard | `quarantine` | A hidden window made more `resource.*` requests than `hiddenResourceAllowance`. The binding is revoked. |
| `size:<class>` | ingress guard | `reject` | The envelope is over the size cap for `resource:bytes`, `relay:subscribe` or `outbox:subscribe`. |
| `defer:queue-full` | visibility gate (`visibility-gate.ts`) | `reject` | The hidden window's deferral queue is full. Only the window-level `hello` passes through the gate. |
| `rate:<class>` | focus firewall (`focus-firewall.ts`) | `reject`, or `flag` when the rate's action is `flag` | kehto's `rate:opclass`, `rate:global` or `rate:default` rule fired; the reason names the class, for example `rate:relay:publish`. |
| `matcher:<id>` | focus firewall | `reject` | A kehto content matcher fired, for example `matcher:size:resource:bytes`. The rule id is passed through unchanged. |
| `policy:deny` | focus firewall | `reject` | The applet's firewall policy is `deny`. kernl sets `allow`, so this appears only if a caller changed it. |
| `prompt:<ruleId>` | focus firewall | `reject` | kehto's engine asked for a prompt (for example `prompt:policy:ask`); the guard has no UI and treats it as a rejection. |

## Revocation reasons

`KernlHost.onRevoked(windowId, reason)` receives kehto's revocation reasons (`window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed`, `host`) or `quarantine` when the guard quarantined the window. See [Architecture](../concepts/architecture.md#the-mount-path).

## Related

- [API reference](./api.md): each function's JSDoc names the reasons it throws.
- [Troubleshooting](../guides/troubleshooting.md)
