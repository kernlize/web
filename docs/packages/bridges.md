# @kernlize/bridges

Locator parsing, the bridge contract, the registry that routes and authorises, an HTTP bridge with an SSRF policy, four backend-driven bridges for downloads, sharing and mail, hand-off backends that open an app on the user's device, the adapter that feeds a resource service, user-facing descriptions, and adapters that drive the download programs a person already runs (Transmission, uTorrent, NZBGet, SABnzbd, slskd) through each program's own HTTP API. Zero dependencies.

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

The download program adapters are a separate surface. They serve no locator and are not bridges: each normalises one program's API to a contract, `TorrentClient`, `NzbClient` or `SoulseekClient`, that the `torrent`, `nzb` and `soulseek` services in `@kernlize/core` call for applets ([Download programs](../concepts/download-programs.md), [D-050](../decisions.md#d-050)).

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

### Download program adapters

Each factory takes `ClientOptions` and returns one of three contracts. Every method rejects with an `Error` whose message starts with a `ClientFailure` reason, optionally followed by `: ` and a detail for a developer; nothing else is thrown past an adapter. The reasons are listed in [Error reasons](../reference/errors.md#download-programs).

| Export | Signature | Description |
| --- | --- | --- |
| `createTransmissionClient` | `(options: ClientOptions) => TorrentClient` | Transmission through its RPC interface, in the classic request form (`method`, `arguments`, `result`), with HTTP Basic sign-in. Transmission answers a change to a torrent it does not have with success, so every change first asks whether the torrent is there and rejects `unavailable:not-found` when it is not. A torrent is `error` only for its own failure, not for a tracker's complaint. Verified against Transmission 4.1.4. |
| `createUtorrentClient` | `(options: ClientOptions) => TorrentClient` | uTorrent (or BitTorrent, the same program) through its WebUI API: a token read from `/gui/token.html` and the cookie set with it, sent with `credentials: 'include'`, or forwarded by hand where the runtime exposes `Set-Cookie`. The answer to an add names no torrent, so the info hash is computed here and the list is watched until it appears (`unavailable:outcome-unknown` when it does not). "Add paused" is an add followed by a stop. Follows the documented WebUI API; it has not been run against the program. |
| `createNzbgetClient` | `(options: ClientOptions) => NzbClient` | NZBGet through `/jsonrpc` with HTTP Basic. `actions` is all six; `addOptions` is all four. `cancel` is `GroupParkDelete`, which keeps what was downloaded; `retry` reuses the job's files and falls back to a fresh download, keeping the id; each ended job offers `forget` or `delete`, never both, according to whether NZBGet would remove its files. Every change is confirmed by reading the job again. Verified against NZBGet 26.3. |
| `createSabnzbdClient` | `(options: ClientOptions) => NzbClient` | SABnzbd through `/api` with its API key (`endpoint.apiKey`). No `cancel`: SABnzbd cannot stop a job and keep a record of it. `retry` makes a new job, so `control` resolves with the successor's id; `delete` is offered only for a failed job with partial files. A job cannot be added both held and with a priority of its own (`unavailable:unsupported`). Every change is confirmed by reading the job again. Verified against SABnzbd 5.1.3. |
| `createSlskdClient` | `(options: ClientOptions) => SoulseekClient` | slskd through `/api/v0`: with `endpoint.apiKey` every request carries the key; with a name and password the adapter signs in once and carries the session token, signing in again when the daemon stops accepting it. slskd has no search aimed at one peer, so `username` filters a network search; `searchResults().files` is empty until `complete`. Verified against slskd 0.26.2, except search results and transfers, which could not be observed without a network login. |
| `ClientOptions` | interface | `{ endpoint: ClientEndpoint; fetch?: ClientFetch; timeoutMs?: number }`. `timeoutMs` is 15 000 by default; a request over it fails as `unavailable:timeout`. |
| `ClientEndpoint` | interface | `{ url: string; username?: string; password?: string; apiKey?: string }`. `url` is an absolute `http:` or `https:` address without credentials, query or fragment. |
| `ClientFetch` | type | `(input: string, init?: RequestInit) => Promise<Response>`. The page's `fetch` by default; a host outside a browser supplies its own. |
| `ClientProbe` | interface | `{ version: string }`: what every contract's `probe()` resolves with, in the program's own words. |
| `ClientFailure` | type | The reasons an adapter rejects with: `unavailable:unreachable`, `unavailable:timeout`, `denied:credentials`, `unavailable:bad-response`, `unavailable:rejected`, `unavailable:not-found`, `unavailable:unsupported`, `unavailable:outcome-unknown`, `unavailable:peer-unavailable`, `denied:peer` and `invalid:<what>`. |
| `TorrentClient` | interface | `probe()`, `add(source, options?: { paused? }) => { infoHash }` (adds, or finds the torrent already there), `list()`, `get(infoHash)` (undefined when absent), `files(infoHash)` (empty until the metadata is known), `selectFiles(infoHash, indexes, { selected?, priority? })`, `pause`, `resume`, `remove(infoHash, deleteData)`, `setLimits(infoHash, limits)`. Torrents are named by lowercase 40-character v1 info hash. |
| `TorrentClientSource` | union | `{ kind: 'magnet'; magnet: string }` or `{ kind: 'metainfo'; bytes: Uint8Array }`. |
| `TorrentClientJob` | interface | `{ infoHash, name, state, downloadedBytes, uploadedBytes, totalBytes?, progress?, downloadRate, uploadRate, peers, seeds, leeches, etaSeconds?, downloadLimit, uploadLimit, private?, error? }`. Rates and limits are bytes a second; a limit of 0 means the torrent has none of its own; `progress` runs from 0 to 1. |
| `TorrentClientState` | type | `'queued' \| 'metadata' \| 'downloading' \| 'seeding' \| 'paused' \| 'complete' \| 'error'`. |
| `TorrentClientFile` | interface | `{ index, path, size, downloadedBytes, selected, priority }`. `path` is inside the torrent, `/`-separated, never a path on the program's disk; `priority` is -1, 0 or 1. |
| `TorrentClientLimits` | interface | `{ downloadLimit?: number; uploadLimit?: number }` in bytes a second; 0 removes the torrent's own limit. |
| `NzbClient` | interface | `actions`, `addOptions`, `probe()`, `categories()`, `add(request) => { id }` (rejects `unavailable:rejected` when the downloader declines without creating a job), `list()` (queue and history, each job once), `get(id)` (undefined when absent), `control(id, action) => { id }` (the id differs when a retry made a successor). |
| `NzbClientAdd` | interface | `{ bytes: Uint8Array; name: string; category?; priority?: 'low' \| 'normal' \| 'high'; paused?; password? }`. `bytes` is the NZB XML, already validated by the caller; the adapter makes `name` a safe file name. |
| `NzbClientJob` | interface | `{ id, name, state, paused?, progress?, downloadedBytes?, totalBytes?, downloadRate?, stage?, message?, category?, actions }`. `actions` is what this adapter can do to the job in its present phase. |
| `NzbClientState` | type | `'queued' \| 'downloading' \| 'paused' \| 'processing' \| 'completed' \| 'failed' \| 'cancelled' \| 'skipped' \| 'unknown'`. |
| `NzbClientAction` | type | `'pause' \| 'resume' \| 'cancel' \| 'retry' \| 'forget' \| 'delete'`. |
| `NzbClientAddOption` | type | `'categoryId' \| 'priority' \| 'startPaused' \| 'password'`: the optional submission fields an adapter can honour. |
| `NzbClientCategory` | interface | `{ name: string }`, the downloader's own name for a category. |
| `SoulseekClient` | interface | `probe()`, `state() => 'offline' \| 'online'`, `startSearch(text, { username?, timeoutMs, limit }) => { id }`, `searchResults(id)`, `stopSearch(id)`, `deleteSearch(id)`, `browse(username)` (rejects `unavailable:peer-unavailable` or `denied:peer`), `download({ username, path, size }) => { id }`, `transfer(username, id)` (undefined when absent), `cancel(username, id, remove)`. |
| `SoulseekClientFile` | interface | `{ username, path, size, locked, extension?, bitrateKbps?, durationSeconds?, sampleRateHz?, bitDepth? }`. `path` is the peer's own virtual path, kept as sent; `size` is unsigned decimal text. |
| `SoulseekClientSearch` | interface | `{ complete: boolean; files: readonly SoulseekClientFile[] }`. |
| `SoulseekClientTransfer` | interface | `{ id, username, path, size, state, received, queuePosition?, bytesPerSecond?, failure?, message? }`. `failure` is present exactly when `state` is `failed`. |
| `SoulseekClientTransferState` | type | `'queued' \| 'transferring' \| 'complete' \| 'cancelled' \| 'failed'`. |
| `SoulseekClientFailure` | type | `'peer_unavailable' \| 'peer_denied' \| 'timeout' \| 'limit_exceeded' \| 'backend_error'`: why a transfer failed, as NAP-SOULSEEK names it. |

A browser adds its own rule: the program has to accept requests from the page's origin. SABnzbd, NZBGet and slskd do; Transmission and uTorrent do not, and reject as `unavailable:unreachable` from a page on another origin. See [Connect a download program](../how-tos/connect-a-download-program.md#let-the-page-in).

### Program addresses

| Export | Signature | Description |
| --- | --- | --- |
| `checkClientEndpoint` | `(address: string, page: PageScheme) => EndpointCheck` | Checks a complete address, scheme included, against how the page running kernl was loaded, and normalises it (lower-case scheme and host, no trailing slash). Refuses `invalid:address` (not a URL, or one with a query or fragment), `invalid:scheme` (not `http` or `https`), `invalid:credentials-in-address` and `invalid:mixed-content` (an `https` page and an `http` address that is not this device). |
| `endpointCandidates` | `(typed: string, page: PageScheme) => readonly EndpointCheck[]` | The addresses to try, in order. With a scheme it is that one check. Without one it is `https` then `http`, leaving out any the page may not call. Never empty: when nothing may be tried it holds the one refusal. |
| `detectClientEndpoint` | `<T>(typed: string, page: PageScheme, probe: (url: string) => Promise<T>) => Promise<{ endpoint; result: T }>` | Tries each allowed candidate with `probe` and settles on the first that answers. A probe that rejects `denied:credentials` ends the search, so a sign-in is not offered to a second address. Rejects with the refusal's `invalid:` reason when no candidate may be tried, otherwise with what the last probe rejected with. |
| `EndpointCheck` | union | `{ ok: true; url; scheme: PageScheme; loopback: boolean; notes: readonly EndpointNote[] }` or `{ ok: false; reason }`. |
| `EndpointNote` | type | `'cleartext'` (`http` to another machine), `'cleartext-loopback'` (`http` to this device) or `'page-insecure'` (an `https` address typed into a page loaded over `http`). |
| `PageScheme` | type | `'http' \| 'https'`: how the page that runs kernl was loaded. |

"This device" is what a browser treats as such for mixed content: `localhost` and names under `.localhost`, with or without a trailing dot, `127.0.0.0/8` and `[::1]`.

### Torrent files and magnet links

| Export | Signature | Description |
| --- | --- | --- |
| `readTorrentMetainfo` | `(bytes: Uint8Array) => Promise<TorrentMetainfo>` | Reads a `.torrent` file strictly enough to trust its info hash: canonical bencode only, the v1 fields, and file paths that stay inside the torrent. The hash is the SHA-1 of the `info` dictionary's bytes as they appear in the file. Rejects `invalid:metainfo` for anything malformed or unsafe and `invalid:metainfo-format` for a v2 torrent with no v1 piece hashes. |
| `magnetInfoHash` | `(magnet: string) => string` | The v1 info hash a magnet link names, from its first `xt=urn:btih:` topic, as 40 lowercase hexadecimal characters whether the link wrote it in hex or in base32. Throws `invalid:magnet`. |
| `TorrentMetainfo` | interface | `{ infoHash, name, private, totalBytes, files: { path, size }[], trackers }`. |

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

- Does not implement any transfer protocol. The hand-off backends only build an address and open it; backends that move data live in the shell app or in packages of their own. A download program adapter moves nothing either: it tells the person's program what to do and reads back what it reports.
- Does not keep an address, a password or a key. An adapter is handed its `ClientEndpoint`; `@kernlize/core` keeps the settings and asks its secrets provider for the sign-in ([Secrets](../concepts/secrets.md)).
- Does not prompt. Consent is a `BridgeAuthorizer` the host can supply to the registry; `createKernl`'s default registry has none.
- Does not apply the guard. Rate limits and the hidden-window allowance run in `@kernlize/guard` before a request reaches the registry.
- Does not know about NAP envelopes. `@kernlize/core` maps `resource.*` requests onto `createBridgeResourceResolver(registry)`.

## Specification

`packages/bridges/features/`: `locators.feature`, `registry.feature`, `http-bridge.feature`, `backend-bridges.feature`, `handoff-backends.feature`, `webtorrent-backend.feature`, `resource-resolver.feature`, `describe.feature`, `transmission-client.feature`, `utorrent-client.feature`, `nzbget-client.feature`, `sabnzbd-client.feature`, `slskd-client.feature`, `client-endpoint.feature`, `torrent-metainfo.feature`.

## API reference

Generated module: [`_kernlize_bridges`](../api/modules/_kernlize_bridges.html){target="_self"}
