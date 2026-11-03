# @kernl/bridges

Locator parsing, the bridge contract, the registry that routes and authorises, an HTTP bridge with an SSRF policy, four backend-driven bridges for downloads, sharing and mail, the adapter that feeds a resource service, and user-facing descriptions. Zero dependencies.

| Field | Value |
| --- | --- |
| Package | `@kernl/bridges` |
| Version | `0.1.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | none |
| Peer dependencies | none |
| Side effects | none |

## Install

```bash
pnpm add @kernl/bridges
```

## Purpose

A bridge resolves a protocol-specific locator to bytes, a job or a conversation on the user's behalf, behind the same consent and quota as everything else, and is named by what it does rather than by its protocol. The HTTP bridge is complete; the torrent, NZB, Soulseek and mail bridges are complete up to the backend interface they call and report `unavailable` until one is supplied. The concepts are in [Bridges](../concepts/bridges.md); the opinion is D-010.

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
| `BridgeExposure` | interface | `{ revealsAddress; encryptedInTransit; publicActivity }`, three booleans the user reads before consenting. |
| `BridgeAvailability` | union | `{ available: true }` or `{ available: false; reason: string }`. The reason is a bare word such as `no-backend`. |
| `BridgeAuthorizer` | type | `(locator, bridge, context) => boolean \| Promise<boolean>`; the shell's consent hook. |

### Registry

| Export | Signature | Description |
| --- | --- | --- |
| `createBridgeRegistry` | `(options?: BridgeRegistryOptions) => BridgeRegistry` | Owns every bridge, routes a locator to the bridge serving its scheme, runs the consent hook, reports every outcome. |
| `BridgeRegistryOptions` | interface | `{ authorize?: BridgeAuthorizer; onResolve?: (event: BridgeResolveEvent) => void }`. Without `authorize` every request is allowed. |
| `BridgeResolveEvent` | interface | `{ bridge: string; scheme: string; ok: boolean; reason?: string }`. `bridge` is `none` when no bridge serves the scheme or the string did not parse. |
| `BridgeRegistry` | interface | `register(bridge)` (throws `invalid:duplicate-bridge <id>`, `invalid:scheme-taken <scheme>`), `list()`, `forScheme(scheme)` (case-insensitive, trailing colon allowed), `resolve(uri, context)` (rejects with `invalid:`, `unavailable:` or `denied:` reasons). |

### HTTP bridge

| Export | Signature | Description |
| --- | --- | --- |
| `createHttpBridge` | `(options?: HttpBridgeOptions) => Bridge` | Id `http`, label `downloads`. Allowed schemes only, no private or local destinations (re-checked on every redirect hop and, with `resolveHost`, after name resolution), a redirect cap, a time limit and a byte limit enforced on the streamed body. |
| `HttpBridgeOptions` | interface | `{ policy?: Partial<HttpPolicy>; fetch?: typeof fetch; resolveHost?: (host: string) => Promise<readonly string[]> }`. |
| `DEFAULT_HTTP_POLICY` | `HttpPolicy` | `{ allowedSchemes: ['https:'], maxRedirects: 3, maxBytes: 10485760, timeoutMs: 20000, allowPrivateHosts: [] }`. Scheme entries carry the colon, as `URL.protocol` does. |
| `HttpPolicy` | interface | `allowedSchemes`, `maxRedirects`, `maxBytes`, `timeoutMs`, `allowPrivateHosts`. |
| `isPrivateAddress` | `(ip: string) => boolean` | True for literal IPv4 or IPv6 addresses (brackets allowed, IPv4-mapped IPv6 unwrapped) in the unspecified, loopback, private, shared, link-local, unique-local, multicast or reserved ranges. False for public addresses and for strings that are not an IP. Ranges are listed in [Bridges](../concepts/bridges.md#the-http-bridge). |
| `isBlockedHostname` | `(host: string) => boolean` | True for `localhost` and names under `.localhost`, `.local` or `.internal`, in any case, with or without a trailing dot. |

### Backend-driven bridges

| Export | Signature | Description |
| --- | --- | --- |
| `createTorrentBridge` | `(backend?: TorrentBackend) => Bridge` | Id `torrent`, label `downloads`, scheme `magnet`. Exposure: reveals address, not encrypted, public activity. |
| `createNzbBridge` | `(backend?: NzbBackend) => Bridge` | Id `nzb`, label `downloads`, scheme `nzb`. Exposure: reveals address, encrypted, not public. |
| `createSoulseekBridge` | `(backend?: SoulseekBackend) => Bridge` | Id `soulseek`, label `sharing`, scheme `slsk`. Exposure: reveals address, not encrypted, public activity. |
| `createMailBridge` | `(backend?: MailBackend) => Bridge` | Id `mail`, label `mail`, scheme `mailto`. Exposure: does not reveal address, encrypted, not public. |
| `TorrentBackend` | interface | `add(infoHash: string, trackers: readonly string[], context: BridgeContext): Promise<{ id: string; name: string }>`. |
| `NzbBackend` | interface | `add(url: string, context: BridgeContext): Promise<{ id: string; name: string }>`. |
| `SoulseekBackend` | interface | `download(user: string, path: string, context: BridgeContext): Promise<{ id: string; name: string }>`. |
| `MailBackend` | interface | `open(address: string, subject: string \| undefined, context: BridgeContext): Promise<{ id: string }>`. |

Without a backend each of the four reports `{ available: false, reason: 'no-backend' }` and `resolve()` rejects with `unavailable:no-backend`. A locator missing a field the backend needs rejects with `invalid:locator-missing-<field>` before the backend is called.

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
| `describeBridge` | `(bridge: Bridge) => readonly DescriptionRow[]` | Rows for the user: `Used for`, `Status` (`ready` or `not available` plus a `Reason` row), `Shares your network address`, `Encrypted in transit`, `Activity visible to others`. No row names a protocol. |
| `DescriptionRow` | interface | `{ label: string; value: string }`. |

## Example

```ts
import { createBridgeRegistry, createBridgeResourceResolver, createHttpBridge, createTorrentBridge, formatLocator } from '@kernl/bridges';

const registry = createBridgeRegistry({
  authorize: (locator, bridge) => confirm(`Open ${formatLocator(locator)} with ${bridge.label}?`),
  onResolve: (event) => console.log(event),
});
registry.register(createHttpBridge({ resolveHost: lookupAddresses })); // the shell's DNS lookup, (host) => Promise<string[]>
registry.register(createTorrentBridge()); // unavailable until a TorrentBackend is supplied

const result = await registry.resolve('https://example.com/file.bin', { requester: 'shell' });
if (result.kind === 'bytes') result.response.status;

// what @kernl/core hands to kehto's resource service
const fetchLike = createBridgeResourceResolver(registry, { requesterFor: (init) => identityFor(init) }); // identityFor: the shell's window-to-identity map
```

## Scope

- Does not implement any transfer protocol. Backends live in the shell app or in packages of their own.
- Does not prompt. Consent is the `BridgeAuthorizer` the shell supplies to the registry.
- Does not apply the guard. Rate limits and the hidden-window allowance run in `@kernl/guard` before a request reaches the registry.
- Does not know about NAP envelopes. `@kernl/core` maps `resource.*` requests onto `createBridgeResourceResolver(registry)`.

## Specification

`packages/bridges/features/`: `locators.feature`, `registry.feature`, `http-bridge.feature`, `backend-bridges.feature`, `resource-resolver.feature`, `describe.feature`.

## API reference

Generated module: [`_kernl_bridges`](/api/modules/_kernl_bridges.html){target="_self"}
