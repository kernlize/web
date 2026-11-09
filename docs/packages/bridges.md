# @kernlize/bridges

Locator parsing, the bridge contract, the registry that routes and authorises, an HTTP bridge with an SSRF policy, four backend-driven bridges for downloads, sharing and mail, hand-off backends that open an app on the user's device, the adapter that feeds a resource service, and user-facing descriptions. Zero dependencies.

| Field | Value |
| --- | --- |
| npm | `@kernlize/bridges` |
| JSR | `@kernl/bridges` |
| Version | `0.2.1` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | none |
| Peer dependencies | none |
| Side effects | none |

## Install

This package is `@kernlize/bridges` on npm and `@kernl/bridges` on JSR, the same code at the same version. Once released:

```sh
npm install @kernlize/bridges
# or
deno add jsr:@kernl/bridges
```

Neither registry has a release yet, so both commands fail. During the alpha the package is built from the kernl source repository, which is private, and consumed as a workspace dependency under its npm name. The [package index](./index.md#install) has the steps.

```json
{ "dependencies": { "@kernlize/bridges": "workspace:^" } }
```

## Purpose

A bridge resolves a protocol-specific locator to bytes, a job or a conversation on the user's behalf, behind the same grant and quota as everything else (the composed shell wires no per-request consent), and is named by what it does rather than by its protocol. The HTTP bridge is complete. The torrent, NZB, Soulseek and mail bridges are complete up to the backend interface they call; `createHandoffBackends` supplies all four by handing the locator to an app on the user's device, `createWebTorrentBackend` downloads magnet links inside the page instead ([D-017](../decisions.md#d-017)), and without any backend they report `unavailable`. The concepts are in [Bridges](../concepts/bridges.md); the opinion is [D-010](../decisions.md#d-010).

## Exports

### Locators

| Export | Signature | Description |
| --- | --- | --- |
| `parseLocator` | `(uri: string) => Locator` | Scheme and scheme-specific fields for `magnet`, `nzb`, `slsk`, `mailto` and the web schemes `http`, `https`, `ws`, `wss`. Any other well-formed scheme is a locator with no fields. Throws `invalid:locator` or `invalid:magnet-missing-hash`. Field tables are in [Bridges](../concepts/bridges.md#locators). |
| `formatLocator` | `(locator: Locator) => string` | A user-facing label without the scheme: the name where one is known, otherwise the host, peer or hash. |
| `isNzbUrl` | `(url: string) => boolean` | True when the string parses as a URL whose path ends in `.nzb` (any case). `parseLocator` uses it to route such web URLs to the `nzb` scheme. |
| `Locator` | interface | `{ scheme: string; raw: string; fields: Readonly<Record<string, string \| readonly string[]>> }`. |

### Bridge contract

| Export | Signature | Description |
| --- | --- | --- |
| `Bridge` | interface | `{ id; label; schemes; exposure: BridgeExposure; availability(): BridgeAvailability; resolve(locator, context): Promise<BridgeResult> }`. |
| `BridgeContext` | interface | `{ requester: { dTag; hash } \| 'shell'; signal?: AbortSignal; headers?: Readonly<Record<string, string>> }`. |
| `BridgeResult` | union | `{ kind: 'bytes'; response: Response }`, `{ kind: 'job'; id; label }` or `{ kind: 'conversation'; id; participants: readonly string[] }`. |
| `BridgeExposure` | interface | `{ revealsAddress; encryptedInTransit; publicActivity }`, three booleans `describeBridge` renders for the user in the shell settings. |
| `BridgeAvailability` | union | `{ available: true; handoff?: true }` or `{ available: false; reason: string }`. `handoff` is set when resolving opens an app on the user's device instead of kernl moving the data. The reason is a bare word such as `no-backend`. |
| `BridgeAuthorizer` | type | `(locator, bridge, context) => boolean \| Promise<boolean>`; the registry's consent hook. The composed shell supplies none in this draft. |

### Registry

| Export | Signature | Description |
| --- | --- | --- |
| `createBridgeRegistry` | `(options?: BridgeRegistryOptions) => BridgeRegistry` | Owns every bridge, routes a locator to the bridge serving its scheme, runs the `authorize` hook when one is given, reports every outcome to `onResolve` when one is given. |
| `BridgeRegistryOptions` | interface | `{ authorize?: BridgeAuthorizer; onResolve?: (event: BridgeResolveEvent) => void }`. Without `authorize` every request is allowed. |
| `BridgeResolveEvent` | interface | `{ bridge: string; scheme: string; ok: boolean; reason?: string }`. `bridge` is `none` when no bridge serves the scheme or the string did not parse. |
| `BridgeRegistry` | interface | `register(bridge)` (throws `invalid:duplicate-bridge <id>`, `invalid:scheme-taken <scheme>`), `list()`, `forScheme(scheme)` (case-insensitive, trailing colon allowed), `resolve(uri, context)` (rejects with `invalid:`, `unavailable:` or `denied:` reasons). |

### HTTP bridge

| Export | Signature | Description |
| --- | --- | --- |
| `createHttpBridge` | `(options?: HttpBridgeOptions) => Bridge` | Id `http`, label `downloads`. Allowed schemes only, no private or local destinations (re-checked on every redirect hop and, with `resolveHost`, after name resolution; without it hostnames are judged as literals), a redirect cap, a time limit and a byte limit enforced on the streamed body. In a browser an opaque redirect is refused with `denied:redirect-unverifiable`, and CORS applies. |
| `HttpBridgeOptions` | interface | `{ policy?: Partial<HttpPolicy>; fetch?: typeof fetch; resolveHost?: (host: string) => Promise<readonly string[]> }`. |
| `DEFAULT_HTTP_POLICY` | `HttpPolicy` | `{ allowedSchemes: ['https:'], maxRedirects: 3, maxBytes: 10485760, timeoutMs: 20000, allowPrivateHosts: [] }`. Scheme entries carry the colon, as `URL.protocol` does. |
| `HttpPolicy` | interface | `allowedSchemes`, `maxRedirects`, `maxBytes`, `timeoutMs`, `allowPrivateHosts`. |
| `isPrivateAddress` | `(ip: string) => boolean` | True for literal IPv4 or IPv6 addresses in the unspecified, loopback, private, shared, link-local, IETF protocol assignment, benchmarking, multicast or reserved IPv4 ranges, and the link-local, site-local, unique-local, multicast, discard, local NAT64, 6to4 or Teredo IPv6 ranges. IPv6 is parsed to its full 128 bits (brackets and zone suffix stripped); an address that embeds an IPv4 destination (mapped, compatible, translated, NAT64 `64:ff9b::/96`) is judged by that destination. False for public addresses and for strings that are not an IP. Ranges are listed in [Bridges](../concepts/bridges.md#the-http-bridge). |
| `isBlockedHostname` | `(host: string) => boolean` | True for `localhost` and names under `.localhost`, `.local` or `.internal`, in any case, with or without a trailing dot. |

### Backend-driven bridges

| Export | Signature | Description |
| --- | --- | --- |
| `createTorrentBridge` | `(backend?: TorrentBackend) => Bridge` | Id `torrent`, label `downloads`, scheme `magnet`. Exposure: reveals address, not encrypted, public activity. |
| `createNzbBridge` | `(backend?: NzbBackend) => Bridge` | Id `nzb`, label `downloads`, scheme `nzb`. Exposure: reveals address, encrypted, not public. |
| `createSoulseekBridge` | `(backend?: SoulseekBackend) => Bridge` | Id `soulseek`, label `sharing`, scheme `slsk`. Exposure: reveals address, not encrypted, public activity. |
| `createMailBridge` | `(backend?: MailBackend) => Bridge` | Id `mail`, label `mail`, scheme `mailto`. Exposure: does not reveal address, encrypted, not public. |
| `BackendTraits` | interface | `{ handoff?: true \| undefined }`. Every backend interface extends it; a hand-off backend sets it, and its bridge then reports `{ available: true, handoff: true }`. The bridge reads it on every availability check, so a backend may switch it, as the shell's does when the user changes where downloads go. |
| `TorrentBackend` | interface | `add(infoHash: string, trackers: readonly string[], context: BridgeContext, name?: string): Promise<{ id: string; name: string }>`. `name` is the magnet's display name when it has one. |
| `NzbBackend` | interface | `add(url: string, context: BridgeContext): Promise<{ id: string; name: string }>`. |
| `SoulseekBackend` | interface | `download(user: string, path: string, context: BridgeContext): Promise<{ id: string; name: string }>`. |
| `MailBackend` | interface | `open(address: string, subject: string \| undefined, context: BridgeContext, body?: string): Promise<{ id: string }>`. |

Without a backend each of the four reports `{ available: false, reason: 'no-backend' }` and `resolve()` rejects with `unavailable:no-backend`. A locator missing a field the backend needs rejects with `invalid:locator-missing-<field>` before the backend is called.

### Hand-off backends

| Export | Signature | Description |
| --- | --- | --- |
| `createHandoffBackends` | `(open: HandoffOpener) => HandoffBackends` | One backend per bridge, each with `handoff: true`. Each rebuilds the canonical address from the parsed fields (a `magnet:` link with hash, name and trackers; an `slsk://` address; a `mailto:` address with subject and body; the NZB document's `https` URL) and passes it to `open` once. Ids come from one shared counter, `handoff:1`, `handoff:2`, and so on. The NZB backend throws `invalid:nzb-not-https` for a document not served over `https`. |
| `HandoffOpener` | type | `(uri: string) => void \| Promise<void>`. The shell passes `host.openLink`, which asks the user before leaving kernl. |
| `HandoffBackends` | interface | `{ torrent: TorrentBackend; soulseek: SoulseekBackend; mail: MailBackend; nzb: NzbBackend }`. |

A hand-off makes no connection from kernl; the app on the device does the transfer with its own network, which kernl cannot see or limit. See [Bridges](../concepts/bridges.md#hand-off-backends).

### Downloads inside kernl

| Export | Signature | Description |
| --- | --- | --- |
| `createWebTorrentBackend` | `(options: WebTorrentBackendOptions) => WebTorrentBackend` | A `TorrentBackend` without a `handoff` trait that downloads through a WebTorrent client inside the page. Throws `invalid:info-hash` for a hash that is not 40 hex characters and `unavailable:<why>` when the client cannot load or refuses the link. The same hash twice is one job; ids are `download:1`, `download:2`, and so on. |
| `WebTorrentBackendOptions` | interface | `{ client: WebTorrentLike \| (() => WebTorrentLike \| Promise<WebTorrentLike>); trackers?: readonly string[]; now?: () => number; progressIntervalMs?: number }`. A loader runs on the first download and again after a failure. `trackers` replaces `DEFAULT_WEBRTC_TRACKERS`; progress-only notifications are at most one per `progressIntervalMs` (500 by default). |
| `WebTorrentBackend` | interface | `TorrentBackend` plus `jobs()`, `subscribe(listener) => stop`, `pause(id)`, `resume(id)`, `remove(id)` (drops the job and its stored data) and `files(id) => Promise<readonly DownloadedFile[]>`. An unknown id throws `denied:unknown-download`; `files` on an unfinished job rejects with `unavailable:not-finished`. |
| `DownloadJob` | interface | `{ id, name, infoHash, state, progress, received, size?, peers, speed, error? }`. `progress` runs from 0 to 1; sizes are bytes; `speed` is bytes per second and 0 unless downloading. |
| `DownloadState` | type | `'connecting' \| 'downloading' \| 'paused' \| 'done' \| 'failed'`. |
| `DownloadedFile` | interface | `{ name: string; size: number; blob: Blob }`. |
| `DownloadListener` | type | `(jobs: readonly DownloadJob[]) => void`. |
| `WebTorrentLike`, `WebTorrentTorrentLike`, `WebTorrentFileLike` | interfaces | The parts of a WebTorrent client, torrent and file the backend uses, so the package has no dependency on the library: `add(magnet)`, `remove(torrent, { destroyStore })`; a torrent's `name`, `length`, `downloaded`, `progress`, `downloadSpeed`, `numPeers`, `done`, `files`, `on(event, listener)`, `pause()`, `resume()`; a file's `name`, `length`, `blob()`. |
| `DEFAULT_WEBRTC_TRACKERS` | `readonly string[]` | `wss://tracker.openwebtorrent.com`, `wss://tracker.webtorrent.dev`, `wss://tracker.btorrent.xyz`. |
| `webTrackers` | `(trackers: readonly string[], defaults?: readonly string[]) => readonly string[]` | The link's `wss://` trackers, then the defaults, without duplicates. A page cannot open the UDP or TCP sockets other trackers need. |

NZB, Soulseek and mail have no in-page backend: their protocols need raw TCP sockets, which a browser page cannot open. See [Bridges](../concepts/bridges.md#why-nzb-soulseek-and-mail-still-hand-off).

### Resource resolver

| Export | Signature | Description |
| --- | --- | --- |
| `createBridgeResourceResolver` | `(registry: BridgeRegistry, options?: BridgeResourceResolverOptions) => BridgeResourceResolver` | Adapts a registry to the `fetch(url, init)` seam of a resource service. `bytes` results return their `Response`; `job` and `conversation` results become a `202 Accepted` JSON body. Failures reject with the registry's reasons. |
| `BridgeResourceResolver` | type | `(url: string, init: ResourceResolveInit) => Promise<Response>`. |
| `ResourceResolveInit` | interface | `{ signal?: AbortSignal; headers?: Record<string, string>; requester?: BridgeContext['requester'] }`. |
| `BridgeResourceResolverOptions` | interface | `{ requesterFor?: (init: ResourceResolveInit) => BridgeContext['requester'] }`. Used when the init names no requester; the fallback is `'shell'`. |

### Descriptions

| Export | Signature | Description |
| --- | --- | --- |
| `describeBridge` | `(bridge: Bridge) => readonly DescriptionRow[]` | Rows for the user: `Used for`, `Status` (`ready` or `not available` plus a `Reason` row; a hand-off bridge adds `Handled by: an app on your device` and `Sent through kernl: no`), `Shares your network address`, `Encrypted in transit`, `Activity visible to others`. No row names a protocol. |
| `DescriptionRow` | interface | `{ label: string; value: string }`. |

## Example

```ts
import { createBridgeRegistry, createBridgeResourceResolver, createHandoffBackends, createHttpBridge, createTorrentBridge, formatLocator, type ResourceResolveInit } from '@kernlize/bridges';

declare const lookupAddresses: (host: string) => Promise<string[]>; // the shell's DNS lookup
declare const identityFor: (init: ResourceResolveInit) => { dTag: string; hash: string } | 'shell'; // the shell's window-to-identity map

const registry = createBridgeRegistry({
  authorize: (locator, bridge) => confirm(`Open ${formatLocator(locator)} with ${bridge.label}?`),
  onResolve: (event) => console.log(event),
});
registry.register(createHttpBridge({ resolveHost: lookupAddresses }));
const handoff = createHandoffBackends((uri) => {
  if (confirm(`Leave and open ${uri}?`)) window.open(uri, '_blank', 'noopener,noreferrer');
});
registry.register(createTorrentBridge(handoff.torrent)); // { available: true, handoff: true }

const result = await registry.resolve('https://example.com/file.bin', { requester: 'shell' });
if (result.kind === 'bytes') result.response.status;

// what @kernlize/core hands to kehto's resource service
const fetchLike = createBridgeResourceResolver(registry, { requesterFor: (init) => identityFor(init) });
```

## Scope

- Does not implement any transfer protocol. The hand-off backends only build an address and open it; backends that move data live in the shell app or in packages of their own.
- Does not prompt. Consent is a `BridgeAuthorizer` the host can supply to the registry; `createKernl`'s default registry has none.
- Does not apply the guard. Rate limits and the hidden-window allowance run in `@kernlize/guard` before a request reaches the registry.
- Does not know about NAP envelopes. `@kernlize/core` maps `resource.*` requests onto `createBridgeResourceResolver(registry)`.

## Specification

`packages/bridges/features/`: `locators.feature`, `registry.feature`, `http-bridge.feature`, `backend-bridges.feature`, `handoff-backends.feature`, `webtorrent-backend.feature`, `resource-resolver.feature`, `describe.feature`.

## API reference

Generated module: [`_kernlize_bridges`](../api/modules/_kernlize_bridges.html){target="_self"}
