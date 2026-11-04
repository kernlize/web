# Bridges

Nostr is kernl's identity and resolution layer. It is not the only protocol kernl speaks. A bridge is a shell-owned service that resolves a protocol-specific locator to bytes, a job or a conversation, behind the same grant and quota as everything else: an applet needs the `resource` grant, and the guard's rates apply to its requests. There is no per-request bridge consent in this draft. Bridges are named by what they do for the user, never by the protocol they speak ([D-010](../decisions.md#d-010)).

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

`describeBridge(bridge)` returns, in order: `Used for` (the label), `Status` (`ready`, or `not available` followed by a `Reason` row with the bare reason such as `no-backend`), then the three exposure rows as `yes`/`no`. A bridge whose availability is `{ available: true, handoff: true }` gets two more rows after `Status: ready`: `Handled by: an app on your device` and `Sent through kernl: no`. The exposure rows stay as they are for a hand-off bridge, because the app on the device speaks the same protocol and exposes the user the same way ([Hand-off backends](#hand-off-backends)). No row names a protocol. These are descriptions, not scores; like messaging providers, bridges are not ranked. See `describe.feature`.

## The registry and its authorize hook

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

Every outcome, successful or not, is reported to `onResolve` as `{ bridge, scheme, ok, reason? }`, when the registry was given one. The composed shell gives none, so bridge outcomes reach neither the guard panel nor any other surface the user sees. The authoriser is a `BridgeAuthorizer`: `(locator, bridge, context) => boolean | Promise<boolean>`. Without one, every request is allowed. The composed shell has none: `createKernl` builds its registry with `createDefaultBridges({ handoff: (uri) => host.openLink(uri), torrent })` (the torrent backend only when `KernlOptions.torrent` is given) and no `authorize`, so a `resource` request from an applet that holds the `resource` grant is checked by the HTTP bridge's policy and nothing else. There is no per-host consent prompt and no per-host grant in this draft ([Alpha status](../alpha-status.md#what-does-not-work-yet)); wiring one is on the [Roadmap](../roadmap.md#_6-guard). A host can pass its own registry with an `authorize` hook in `KernlOptions.bridges`. See `registry.feature`.

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

Four bridges are complete up to the backend interface they call. Each takes its backend as an optional argument.

| Bridge id | Label | Scheme | Reveals address | Encrypted in transit | Public activity | Backend interface | Call made |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `torrent` | `downloads` | `magnet` | yes | no | yes | `TorrentBackend` | `add(infoHash, trackers, context, name?) → { id, name }` |
| `nzb` | `downloads` | `nzb` | yes | yes | no | `NzbBackend` | `add(url, context) → { id, name }` |
| `soulseek` | `sharing` | `slsk` | yes | no | yes | `SoulseekBackend` | `download(user, path, context) → { id, name }` |
| `mail` | `mail` | `mailto` | no | yes | no | `MailBackend` | `open(address, subject \| undefined, context, body?) → { id }` |

The first three return `{ kind: 'job', id, label: name }`; the mail bridge returns `{ kind: 'conversation', id, participants: addresses }`. Fields are read from the locator before the backend is called; a locator missing one rejects with `invalid:locator-missing-<field>` (`backend-bridges.feature`, scenario "a locator missing a required field is rejected before the backend is called").

Every backend interface extends `BackendTraits`, whose one field is `handoff?: true`. The bridge reads it on every `availability()` call, so a backend that lets the user choose between moving data itself and handing off may switch it. A bridge reports:

| Backend | `availability()` | `resolve()` |
| --- | --- | --- |
| none | `{ available: false, reason: 'no-backend' }` | rejects with `unavailable:no-backend` |
| one that moves data itself | `{ available: true }` | calls the backend |
| one with `handoff: true` | `{ available: true, handoff: true }` | calls the backend, which opens an app on the device |

Nothing pretends to work: a bridge without a backend says so in its status and reason.

### Hand-off backends

`createHandoffBackends(open)` returns `{ torrent, soulseek, mail, nzb }`, one backend for each bridge, all with `handoff: true`. Each rebuilds the locator's canonical address from the fields kernl parsed, so the address it opens carries only what kernl understood, and passes it to `open` once:

| Backend | Opens | Result |
| --- | --- | --- |
| `torrent` | `magnet:?xt=urn:btih:<infoHash>`, then `&dn=<name>` when a name was given and one `&tr=<tracker>` per tracker, each value URL-encoded. Web seeds are dropped. | job labelled with the name, else the hash |
| `soulseek` | `slsk://<user>/<path>`, with the user and each path segment URL-encoded | job labelled with the last path segment, else the user |
| `mail` | `mailto:<address>`, then `?subject=…&body=…` for those present | conversation with the parsed addresses |
| `nzb` | the document's `https` URL itself, so the device's NZB client or browser takes it. A document served over plain `http` is refused with `invalid:nzb-not-https` and nothing is opened. | job labelled with the last path segment, else the host |

The four share one counter, so successive hand-offs get ids `handoff:1`, `handoff:2` and so on. The backend awaits `open` before it reports the result. `HandoffOpener` is `(uri: string) => void | Promise<void>`. See `handoff-backends.feature`.

`createDefaultBridges` takes an optional `handoff` opener. With one, it builds the torrent, NZB, Soulseek and mail bridges over `createHandoffBackends(handoff)`; without one, those four report `no-backend` as before. `createKernl` passes `host.openLink`, so all four are available in the live shell. The shell's `openLink` asks the user to confirm before leaving kernl ("Leave kernl and open this link?") and then opens the address in a new browsing context with `noopener,noreferrer`, which the browser hands to whatever app the device registers for the scheme. If the user declines, nothing is opened, but `openLink` does not report the refusal, so the bridge still returns its job or conversation.

What the user is exposed to:

- **kernl's network sees nothing.** For a hand-off, kernl makes no connection: no swarm, indexer, news server, peer or mail provider is contacted by the shell or by any applet. The address is the only thing that leaves kernl, and it leaves to the device, not to the network.
- **The device app's behaviour is outside kernl.** The torrent client, the Soulseek client, the mail program or the NZB downloader then does what it does, with its own settings and its own network. The exposure rows describe what that protocol normally exposes, which is why they stay the same as for an in-shell backend, but kernl cannot see, limit or revoke what the app does. If no app is registered for the scheme, the browser decides what happens.

### Downloads inside kernl

Magnet links download inside the shell page ([D-017](../decisions.md#d-017)). `createWebTorrentBackend({ client, trackers?, now?, progressIntervalMs? })` is a `TorrentBackend` over a WebTorrent client. `client` is a structural `WebTorrentLike` or a function that returns one (or a promise of one), so `@kernl/bridges` has no dependency on the library and the shell can load it on the first download. A loader that fails is tried again on the next download.

| Step | What happens |
| --- | --- |
| hash | Lowercased; anything but 40 hex characters rejects with `invalid:info-hash` before the client loads. |
| trackers | Only the link's `wss://` trackers are kept, then `DEFAULT_WEBRTC_TRACKERS` (`wss://tracker.openwebtorrent.com`, `wss://tracker.webtorrent.dev`, `wss://tracker.btorrent.xyz`) or the `trackers` option are appended, without duplicates. A page reaches peers only over WebRTC, and only a secure-socket tracker introduces it to them; `webTrackers(list, defaults?)` is the filter. |
| add | The client gets `magnet:?xt=urn:btih:<hash>&dn=<name>&tr=…`. The same hash twice is one job. A client that fails to load or throws rejects with `unavailable:<why>`. |
| job | Ids are `download:1`, `download:2`, and so on. The label is the link's name, else the hash, until the swarm sends the real name. |

The backend also exposes what the Downloads panel needs:

| Method | Does | Fails with |
| --- | --- | --- |
| `jobs()` | Every `DownloadJob` in the order added: `id`, `name`, `infoHash`, `state` (`connecting`, `downloading`, `paused`, `done`, `failed`), `progress` (0 to 1), `received`, `size` once known, `peers`, `speed` (bytes per second, 0 unless downloading), `error` once failed | |
| `subscribe(listener)` | Calls the listener now and on every change; returns the function that stops it. Progress-only changes are reported at most once per `progressIntervalMs` (500 ms by default). | |
| `pause(id)`, `resume(id)` | Pauses or resumes the transfer | `denied:unknown-download` |
| `remove(id)` | Drops the job and asks the client to remove the torrent with its stored data | `denied:unknown-download` |
| `files(id)` | `{ name, size, blob }` for each file of a finished job | `denied:unknown-download`, `unavailable:not-finished` |

The backend has no `handoff` trait, so the bridge reports `{ available: true }` and `describeBridge` gives `Status: ready` without the `Handled by` and `Sent through kernl` rows. The exposure rows stay: peers see the user's network address, the transfer is not encrypted, and what the user fetches is visible to the swarm. See `webtorrent-backend.feature`.

`createDefaultBridges({ handoff, torrent })` builds the torrent bridge over `torrent` when given, and over the hand-off otherwise; NZB, Soulseek and mail still hand off. `createKernl` passes `KernlOptions.torrent` through. The web shell supplies a backend that follows the user's choice in Settings: **Download in kernl**, the default when the browser has `RTCPeerConnection`, or **Open in an app on your device**, which uses the hand-off backend. The choice is stored under `kernl:downloads:mode:v1`. The WebTorrent library (`webtorrent` 3.0.21, browser build) loads only in the shell host page, and only when the first download starts. Applet frames never get it: their CSP and kehto's prelude still remove WebRTC from them.

### Why NZB, Soulseek and mail still hand off

A browser page can open HTTP requests, WebSockets and WebRTC connections, and nothing else. NZB downloads need NNTP to a news server, Soulseek its own protocol to a central server and to peers, and mail SMTP and IMAP; all of them run over raw TCP sockets, which no page can open. They stay hand-off until kernl can reach a companion service that opens those sockets for the user ([Roadmap](../roadmap.md#_2-bridge-backends)). Supplying another backend is a shell change plus a docs change; see [Add a bridge backend](../how-tos/add-a-bridge-backend.md).

## The resource resolver

kehto's resource service takes a `fetch(url, init)` function. `createBridgeResourceResolver(registry, { requesterFor? })` returns one over the registry. The requester is `init.requester` when the service names it, else `requesterFor(init)` when the shell supplied a way to derive it (for example from the window id), else `'shell'`. `init.signal` and `init.headers` reach the bridge. A `bytes` result is returned as its `Response`; a `job` or `conversation` result becomes `Response.json(result, { status: 202 })` so the caller can show progress; a failure rejects with the registry's prefixed reason, which the service maps to its error envelope. See `resource-resolver.feature`.

## Error reasons

| Reason | Thrown by |
| --- | --- |
| `invalid:locator` | `parseLocator` for anything that is not a locator or a malformed web, NZB, Soulseek or mail locator |
| `invalid:magnet-missing-hash` | `parseLocator` for a magnet without a `urn:btih:` hash |
| `invalid:locator-missing-<field>` | a backend-driven bridge whose locator lacks `infoHash`, `url`, `user`, `path` or `address` |
| `invalid:nzb-not-https` | the NZB hand-off backend, for a document not served over `https` |
| `invalid:info-hash` | the in-kernl download backend, for a hash that is not 40 hex characters |
| `unavailable:<why>` | the in-kernl download backend, when the client cannot load or refuses the link |
| `unavailable:not-finished`, `denied:unknown-download` | the in-kernl download backend's `files`, `pause`, `resume` and `remove` |
| `invalid:duplicate-bridge <id>`, `invalid:scheme-taken <scheme>` | `BridgeRegistry.register` |
| `invalid:redirect` | HTTP bridge, redirect without a usable `Location` |
| `unavailable:no-bridge` | `BridgeRegistry.resolve`, no bridge serves the scheme |
| `unavailable:no-backend` | a backend-driven bridge without a backend (`availability().reason` is the bare `no-backend`) |
| `unavailable:timeout`, `unavailable:aborted`, `unavailable:network <message>` | HTTP bridge; in a browser a CORS refusal is `unavailable:network Failed to fetch`, another status-0 answer `unavailable:network <type> response` |
| `denied:bridge` | `BridgeRegistry.resolve`, the authoriser said no |
| `denied:scheme <protocol>`, `denied:private-address <host>`, `denied:private-address <host> -> <ip>`, `denied:too-many-redirects`, `denied:too-large` | HTTP bridge |
| `denied:redirect-unverifiable` | HTTP bridge in a browser, for an opaque redirect it cannot inspect |

## Why bridges are shell-owned

An applet could, in principle, be given a WebRTC or WebSocket path and speak these protocols itself. kernl does not allow that, which is why in-kernl downloads run in the shell page and not in an applet frame, because the CSP [never loosens](./guard.md#why-csp-never-loosens). Routing every protocol through a shell service means every protocol gets the same grant, the same quota, the same exposure description and the same revocation, and a consent prompt per request, which this draft does not have, could be added in one place. The applet asks for a locator; the user's `resource` grant decides whether it may; the shell does the talking.

## Related

- [`@kernl/bridges`](../packages/bridges.md)
- [Security posture](../policies/security-posture.md)
