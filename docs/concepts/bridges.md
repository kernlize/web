# Bridges

Nostr is kernl's identity and resolution layer. It is not the only protocol kernl speaks. A bridge is a shell-owned service that resolves a protocol-specific locator to bytes, a job or a conversation, behind the same consent and quota model as everything else. Bridges are named by what they do for the user, never by the protocol they speak (D-010).

## Locators

A `Locator` is a parsed address: a lowercase `scheme` without the colon, the `raw` string, and scheme-specific `fields`.

| Scheme | Fields | Example |
| --- | --- | --- |
| `https` | `host`, `path` | `https://example.org/file.bin` |
| `magnet` | `infoHash`, `displayName`, `trackers` (list) | `magnet:?xt=urn:btih:…&dn=…&tr=…` |
| `nzb` | `url` | `nzb:https://indexer.example/get/…` |
| `slsk` | `user`, `path` | `slsk://user/path/to/file` |
| `mailto` | `address`, `subject` | `mailto:someone@example.org?subject=Hello` |

`parseLocator(uri)` rejects anything else with `invalid:scheme` and rejects a well-formed scheme with missing fields with `invalid:<field>`. Plain `http:` is not a scheme kernl resolves.

## The bridge contract

```ts
interface Bridge {
  readonly id: string;                 // 'http' | 'torrent' | 'nzb' | 'soulseek' | 'mail'
  readonly label: string;              // 'downloads' | 'mail'
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

The user sees a bridge before they use it, and what they see is its `BridgeExposure`: three booleans, rendered as plain sentences.

| Field | Question it answers |
| --- | --- |
| `revealsAddress` | Does the remote party learn the user's network address? |
| `encryptedInTransit` | Is the transfer encrypted on the wire? |
| `publicActivity` | Can other participants see what the user is fetching? |

The HTTP bridge declares `revealsAddress: true`, `encryptedInTransit: true` (it refuses plain `http:`) and `publicActivity: false`. A torrent bridge would declare `publicActivity: true` because a swarm is public by construction. These are descriptions, not scores; like messaging providers, bridges are not ranked.

## The registry and consent

The shell holds one `BridgeRegistry`:

- `register(bridge)` adds a bridge; `forScheme(scheme)` finds the one that serves a scheme.
- `resolve(uri, context)` parses, routes, authorises and resolves. It rejects with `invalid:` from the parser, `unavailable:` from a bridge without a backend, or `denied:` from the authoriser.

The authoriser is a `BridgeAuthorizer`: `(locator, bridge, context) => boolean | Promise<boolean>`. kernl's shell wires a consent prompt here that shows the user the locator, the bridge's label and exposure, and which applet asked. Allowing a request from an applet is a grant keyed by that applet's identity and the locator's host, and it is listed and revocable like every other grant.

## The HTTP bridge

The HTTP bridge is complete in this draft and serves the `resource` NAP domain. Its `HttpPolicy` is fixed:

| Field | Value | Why |
| --- | --- | --- |
| `allowedSchemes` | `['https']` | Plain HTTP would make `encryptedInTransit` a lie. |
| `maxRedirects` | 3 | Enough for a CDN hop; too few for a redirect loop to be useful. |
| `maxBytes` | 10 MiB | Larger payloads belong to a `job` bridge, not to an applet's memory. |
| `timeoutMs` | 20 000 | A slow origin should fail visibly, not hold the window's resource budget. |
| `allowPrivateHosts` | `[]` | Private-address block on by default. |

The private-address block refuses hosts that resolve to loopback, link-local, RFC 1918, unique-local or metadata ranges, and re-checks after every redirect so a public hostname cannot bounce the request to a private one. A hostname listed in `allowPrivateHosts` is exempt; the list is empty unless the user adds to it, and adding is a shell setting, not an applet request.

The bridge streams the `Response` and counts bytes as they arrive; crossing `maxBytes` aborts the stream and rejects with `denied:max-bytes`. The guard's `hiddenResourceAllowance` and `maxResourceEnvelopeBytes` apply before the request reaches the bridge.

## Backend interfaces

Four bridges ship as parsers plus a backend interface and no backend. Without a backend, `availability()` returns `{ available: false, reason: 'unavailable:no-backend' }` and the shell shows the bridge greyed with that reason. Nothing pretends to work.

| Bridge id | Label | Scheme | Backend interface | Method |
| --- | --- | --- | --- | --- |
| `torrent` | `downloads` | `magnet` | `TorrentBackend` | `add(infoHash, trackers, context) → { id, name }` |
| `nzb` | `downloads` | `nzb` | `NzbBackend` | `add(url, context) → { id, name }` |
| `soulseek` | `downloads` | `slsk` | `SoulseekBackend` | `download(user, path, context) → { id, name }` |
| `mail` | `mail` | `mailto` | `MailBackend` | `open(address, subject, context) → { id }` |

Supplying one is a shell change plus a docs change; see [Add a bridge backend](../how-tos/add-a-bridge-backend.md). The order in which backends are planned is in the [Roadmap](../roadmap.md).

## Why bridges are shell-owned

An applet could, in principle, be given a WebRTC or WebSocket path and speak these protocols itself. kernl does not allow that, because the CSP [never loosens](./guard.md#why-csp-never-loosens). Routing every protocol through a shell service means every protocol gets the same consent prompt, the same quota, the same exposure description and the same revocation. The applet asks for a locator; the user decides; the shell does the talking.

## Related

- [`@kernl/bridges`](../packages/bridges.md)
- [Security posture](../policies/security-posture.md)
