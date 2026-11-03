# Bridges

Nostr is kernl's identity and resolution layer. It is not the only protocol kernl speaks. A bridge is a shell-owned service that resolves a protocol-specific locator to bytes, a job or a conversation, behind the same consent and quota model as everything else. Bridges are named by what they do for the user, never by the protocol they speak ([D-010](../decisions.md#d-010)).

## Locators

A `Locator` is a parsed address: a lowercase `scheme` without the colon, the `raw` string, and scheme-specific `fields`, each a string or a list of strings. `parseLocator(uri)` produces it.

| Scheme | Fields | Notes |
| --- | --- | --- |
| `https`, `http`, `ws`, `wss` | `origin`, `host` (with port when present), `path` (pathname plus query, no fragment) | `HTTPS://Example.com:8443/a/b?c=1#frag` gives scheme `https`, origin `https://example.com:8443`, host `example.com:8443`, path `/a/b?c=1`. A web URL whose path ends in `.nzb` is parsed as an `nzb` locator instead. |
| `magnet` | `infoHash` (40 lowercase hex; a 32-character base32 hash is normalised to hex), `name` (from `dn`, absent when not given), `trackers` (list from every `tr`), `webSeeds` (list from every `ws`) | A magnet without a `urn:btih:` hash of either length fails with `invalid:magnet-missing-hash`. |
| `nzb` | `url` (the `http:` or `https:` document URL), `name` (the URL's `name` query parameter, else its last path segment, decoded) | Two spellings: `nzb://` followed by the URL-encoded document URL, or any web URL ending in `.nzb`. A wrapped URL with another scheme fails with `invalid:locator`. |
| `slsk` | `user`, `path` (both decoded) | `slsk://user/path/to/file`. Both parts are required; `slsk://ada`, `slsk://ada/` and `slsk:///path` fail with `invalid:locator`. |
| `mailto` | `address` (the decoded address part as written), `addresses` (list split on `,` and trimmed), `subject` and `body` (only when present) | `mailto:?subject=Hello` fails with `invalid:locator`. |
| anything else | none | `ftp://files.example/pub/x` is a locator with scheme `ftp` and no fields; the registry will report `unavailable:no-bridge` for it. |

Strings without a scheme (`just words`, `/relative/path`, `1abc:not-scheme`, the empty string) fail with `invalid:locator`. `isNzbUrl(url)` is the test the parser uses for the `.nzb` route. `formatLocator(locator)` returns a label without the scheme: the magnet `name` or else the hash, the NZB `name`, the last segment of the Soulseek path or else the user, the mail addresses joined with `, `, the web `host`, or the raw string after its scheme for unknown schemes. See `locators.feature`.

## The bridge contract

```ts
import type { BridgeAvailability, BridgeContext, BridgeExposure, BridgeResult, Locator } from '@kernl/bridges';

interface Bridge {
  readonly id: string;                 // 'http' | 'torrent' | 'nzb' | 'soulseek' | 'mail'
  readonly label: string;              // 'downloads' | 'sharing' | 'mail'
  readonly schemes: readonly string[];
  readonly exposure: BridgeExposure;
  availability(): BridgeAvailability;
  resolve(locator: Locator, context: BridgeContext): Promise<BridgeResult>;
}
```

`resolve` receives a `BridgeContext`: the `requester` (a verified applet identity `{ dTag, hash }`, or `'shell'` for the user's own request), an optional `AbortSignal` and optional headers. It returns one of three `BridgeResult` shapes:

| `kind` | Payload | Used by |
| --- | --- | --- |
| `bytes` | a `Response` | HTTP |
| `job` | `{ id, label }` for a long-running transfer | torrent, NZB, Soulseek |
| `conversation` | `{ id, participants }` | mail |

## Exposure descriptions

The user sees a bridge before they use it, and what they see is its `BridgeExposure`: three booleans, rendered as plain sentences by `describeBridge`.

| Field | Row label | Question it answers |
| --- | --- | --- |
| `revealsAddress` | Shares your network address | Does the remote party learn the user's network address? |
| `encryptedInTransit` | Encrypted in transit | Is the transfer encrypted on the wire? |
| `publicActivity` | Activity visible to others | Can other participants see what the user is fetching? |

`describeBridge(bridge)` returns, in order: `Used for` (the label), `Status` (`ready`, or `not available` followed by a `Reason` row with the bare reason such as `no-backend`), then the three exposure rows as `yes`/`no`. No row names a protocol. These are descriptions, not scores; like messaging providers, bridges are not ranked. See `describe.feature`.

## The registry and consent

The shell holds one `BridgeRegistry`, built with `createBridgeRegistry({ authorize?, onResolve? })`:

- `register(bridge)` adds a bridge. A second bridge with the same id throws `invalid:duplicate-bridge <id>`; a bridge claiming a scheme another bridge serves throws `invalid:scheme-taken <scheme>`. Schemes are compared lowercase with any trailing colon removed.
- `forScheme(scheme)` finds the bridge that serves a scheme, with the same normalisation (`NZB:` finds the `nzb` bridge).
- `resolve(uri, context)` parses, routes, checks availability, authorises and resolves, in that order, and stops at the first failure.

| Step | Failure reason | `BridgeResolveEvent.bridge` |
| --- | --- | --- |
| parse | `invalid:locator`, `invalid:magnet-missing-hash` | `none`, scheme `""` |
| route | `unavailable:no-bridge` | `none` |
| availability | `unavailable:<reason>` from the bridge | the bridge id |
| authorise | `denied:bridge` | the bridge id |
| resolve | whatever the bridge threw (`denied:…`, `unavailable:…`, `invalid:…`); a non-`Error` rejection is reported as its text | the bridge id |

Every outcome, successful or not, is reported to `onResolve` as `{ bridge, scheme, ok, reason? }`. The authoriser is a `BridgeAuthorizer`: `(locator, bridge, context) => boolean | Promise<boolean>`. Without one, every request is allowed. The composed shell has none: `createKernl` builds its registry with `createDefaultBridges()` and no `authorize`, so a `resource` request from an applet that holds the `resource` grant is checked by the HTTP bridge's policy and nothing else. There is no per-host consent prompt and no per-host grant in this draft ([Alpha status](../alpha-status.md#what-does-not-work-yet)); wiring one is on the [Roadmap](../roadmap.md#_6-guard). A host can pass its own registry with an `authorize` hook in `KernlOptions.bridges`. See `registry.feature`.

## The HTTP bridge

`createHttpBridge({ policy?, fetch?, resolveHost? })` is complete and serves the `resource` NAP domain. Its id is `http`, its label `downloads`, and its `HttpPolicy` is `DEFAULT_HTTP_POLICY` with any `policy` overrides merged in:

| Field | Default | Why |
| --- | --- | --- |
| `allowedSchemes` | `['https:']` (`URL.protocol` form, colon included) | Plain HTTP would make `encryptedInTransit` a lie. |
| `maxRedirects` | `3` | Enough for a CDN hop; too few for a redirect loop to be useful. |
| `maxBytes` | `10485760` (10 MiB) | Larger payloads belong to a `job` bridge, not to an applet's memory. |
| `timeoutMs` | `20000` | A slow origin should fail visibly, not hold the window's resource budget. |
| `allowPrivateHosts` | `[]` | Private-address block on by default. |

The bridge's `schemes` and `exposure` follow the policy: with the default it serves `https` only and declares `revealsAddress: true`, `encryptedInTransit: true`, `publicActivity: false`. A shell that adds `'http:'` to `allowedSchemes` gets a bridge that serves `https` and `http` and declares `encryptedInTransit: false` (`http-bridge.feature`, scenario "the shell can admit the unencrypted scheme and the bridge says so").

Before every request, including every redirect hop, the bridge checks the URL. A scheme outside the policy fails with `denied:scheme <protocol>`. A host that `isBlockedHostname` or `isPrivateAddress` recognises fails with `denied:private-address <host>`, unless it is listed in `allowPrivateHosts`. When `resolveHost` is supplied, the host's addresses are checked too and a private one fails with `denied:private-address <host> -> <ip>`. No caller supplies it in this draft: `createDefaultBridges()` creates the HTTP bridge without `http.resolveHost`, so the composed shell judges a hostname by `isBlockedHostname` and `isPrivateAddress` on the literal alone. A public name that resolves to a private address is not caught, and there is no DNS-rebinding protection. Even with a resolver, the fetch API cannot pin a connection to the validated address, so the check would narrow the rebinding window without closing it.

| Check | Blocked |
| --- | --- |
| `isPrivateAddress`, IPv4 | `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24` (IETF protocol assignments), `192.168.0.0/16`, `198.18.0.0/15` (benchmarking), `224.0.0.0/3` (multicast, reserved and broadcast) |
| `isPrivateAddress`, IPv6, judged by the embedded IPv4 address | IPv4-compatible `::/96` (which covers `::` and `::1`), IPv4-mapped `::ffff:0:0/96`, IPv4-translated `::ffff:0:0:0/96` and the well-known NAT64 prefix `64:ff9b::/96`: the low 32 bits are checked against the IPv4 list above, so `::ffff:127.0.0.1` is blocked and a NAT64 address for a public host is not |
| `isPrivateAddress`, IPv6, blocked outright | link-local `fe80::/10`, deprecated site-local `fec0::/10`, unique-local `fc00::/7`, multicast `ff00::/8`, discard-only `100::/64`, local-use NAT64 `64:ff9b:1::/48`, and the tunnelling prefixes 6to4 `2002::/16` and Teredo `2001::/32`, whose embedded IPv4 address the bridge cannot vouch for |
| `isBlockedHostname` | `localhost` and any name under `.localhost`, `.local` or `.internal`, case-insensitively, trailing dot ignored |

An IPv6 literal is parsed to its full 128 bits before it is judged: `::` is expanded, a dotted IPv4 tail is converted, brackets and a zone suffix (`%eth0`) are stripped, and case is ignored. Every spelling of an address is therefore judged the same way, including the hex form `new URL` normalises `[::ffff:127.0.0.1]` to (`::ffff:7f00:1`). Strings that are neither a valid IPv4 nor a valid IPv6 literal (`1.2.3`, `256.1.1.1`, `1::2::3`, `example.com`) are not addresses and pass `isPrivateAddress`; a hostname is judged by `isBlockedHostname` and, only if a resolver was supplied, by what it resolves to. The shell supplies none, so in the composed shell the check is literal-only.

Every request is made with `redirect: 'manual'`, so the bridge decides about each hop itself. What that yields depends on where the bridge runs:

- **In Node and on servers**, a `301`, `302`, `303`, `307` or `308` response carries its `Location`. The bridge follows it by hand, up to `maxRedirects` hops, and each hop passes the same scheme and host checks. More than `maxRedirects` hops fails with `denied:too-many-redirects`; a redirect without a usable `Location` fails with `invalid:redirect`.
- **In a browser**, which is where the shell runs, `fetch` with `redirect: 'manual'` returns an opaque redirect (`type: 'opaqueredirect'`, status 0) whose target the bridge cannot read. It cannot re-check the next hop, so it refuses the request with `denied:redirect-unverifiable` instead of following blind. A URL that redirects does not load from the shell in this draft; ask for the final URL.

Browser requests are also subject to CORS: the shell's page fetches the URL, so an origin that does not allow cross-origin reads fails, and the browser does not say why. A request the browser blocks, for CORS or because the network failed, surfaces as `unavailable:network Failed to fetch`; any other status-0 answer as `unavailable:network <type> response`, for example `unavailable:network opaque response`. In practice the web bridge in the shell works for `https` origins that permit cross-origin reads and answer without a redirect. Requests race `AbortSignal.timeout(timeoutMs)` and the caller's signal: the time limit fails with `unavailable:timeout`, a caller cancel with `unavailable:aborted`, any other fetch failure with `unavailable:network <message>`. Caller headers are forwarded on every hop.

A response whose `content-length` exceeds `maxBytes` fails with `denied:too-large` before the body is read. Otherwise the `Response` is returned with its status and headers, and its body is streamed through a counter that errors the stream with `denied:too-large` the moment the limit is crossed. Before the request reaches the bridge, kehto's runtime firewall applies the `resource:fetch` rate kernl installed at mount and refuses a request over budget. kernl's guard sees the envelope just before kehto dispatches it but cannot hold it: `maxResourceEnvelopeBytes` and the focus firewall's `resource:bytes` bucket only report, while a hidden window's request past `hiddenResourceAllowance` quarantines the applet, and that request is not dispatched ([Guard](./guard.md#where-enforcement-happens)).

## Backend-driven bridges

Four bridges are complete up to the backend interface they call, and ship without a backend. Without one, `availability()` returns `{ available: false, reason: 'no-backend' }`, `describeBridge` shows `Status: not available` and `Reason: no-backend`, and `resolve()` rejects with `unavailable:no-backend`. Nothing pretends to work.

| Bridge id | Label | Scheme | Reveals address | Encrypted in transit | Public activity | Backend interface | Call made |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `torrent` | `downloads` | `magnet` | yes | no | yes | `TorrentBackend` | `add(infoHash, trackers, context) → { id, name }` |
| `nzb` | `downloads` | `nzb` | yes | yes | no | `NzbBackend` | `add(url, context) → { id, name }` |
| `soulseek` | `sharing` | `slsk` | yes | no | yes | `SoulseekBackend` | `download(user, path, context) → { id, name }` |
| `mail` | `mail` | `mailto` | no | yes | no | `MailBackend` | `open(address, subject \| undefined, context) → { id }` |

The first three return `{ kind: 'job', id, label: name }`; the mail bridge returns `{ kind: 'conversation', id, participants: addresses }`. Fields are read from the locator before the backend is called; a locator missing one rejects with `invalid:locator-missing-<field>` (`backend-bridges.feature`, scenario "a locator missing a required field is rejected before the backend is called"). Supplying a backend is a shell change plus a docs change; see [Add a bridge backend](../how-tos/add-a-bridge-backend.md). The order in which backends are planned is in the [Roadmap](../roadmap.md).

## The resource resolver

kehto's resource service takes a `fetch(url, init)` function. `createBridgeResourceResolver(registry, { requesterFor? })` returns one over the registry. The requester is `init.requester` when the service names it, else `requesterFor(init)` when the shell supplied a way to derive it (for example from the window id), else `'shell'`. `init.signal` and `init.headers` reach the bridge. A `bytes` result is returned as its `Response`; a `job` or `conversation` result becomes `Response.json(result, { status: 202 })` so the caller can show progress; a failure rejects with the registry's prefixed reason, which the service maps to its error envelope. See `resource-resolver.feature`.

## Error reasons

| Reason | Thrown by |
| --- | --- |
| `invalid:locator` | `parseLocator` for anything that is not a locator or a malformed web, NZB, Soulseek or mail locator |
| `invalid:magnet-missing-hash` | `parseLocator` for a magnet without a `urn:btih:` hash |
| `invalid:locator-missing-<field>` | a backend-driven bridge whose locator lacks `infoHash`, `url`, `user`, `path` or `address` |
| `invalid:duplicate-bridge <id>`, `invalid:scheme-taken <scheme>` | `BridgeRegistry.register` |
| `invalid:redirect` | HTTP bridge, redirect without a usable `Location` |
| `unavailable:no-bridge` | `BridgeRegistry.resolve`, no bridge serves the scheme |
| `unavailable:no-backend` | a backend-driven bridge without a backend (`availability().reason` is the bare `no-backend`) |
| `unavailable:timeout`, `unavailable:aborted`, `unavailable:network <message>` | HTTP bridge; in a browser a CORS refusal is `unavailable:network Failed to fetch`, another status-0 answer `unavailable:network <type> response` |
| `denied:bridge` | `BridgeRegistry.resolve`, the authoriser said no |
| `denied:scheme <protocol>`, `denied:private-address <host>`, `denied:private-address <host> -> <ip>`, `denied:too-many-redirects`, `denied:too-large` | HTTP bridge |
| `denied:redirect-unverifiable` | HTTP bridge in a browser, for an opaque redirect it cannot inspect |

## Why bridges are shell-owned

An applet could, in principle, be given a WebRTC or WebSocket path and speak these protocols itself. kernl does not allow that, because the CSP [never loosens](./guard.md#why-csp-never-loosens). Routing every protocol through a shell service means every protocol gets the same grant, the same quota, the same exposure description and the same revocation, and a consent prompt per request can be added in one place. The applet asks for a locator; the user decides; the shell does the talking.

## Related

- [`@kernl/bridges`](../packages/bridges.md)
- [Security posture](../policies/security-posture.md)
