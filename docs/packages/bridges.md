# @kernl/bridges

Locator parsing, bridge contract, registry and HTTP bridge with SSRF policy for the kernl shell. Zero dependencies.

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

A bridge resolves a protocol-specific locator to bytes, a job or a conversation on the user's behalf, behind the same consent and quota as everything else, and is named by what it does rather than by its protocol. The HTTP bridge is complete; the torrent, NZB, Soulseek and mail bridges are parsers plus backend interfaces. The concepts are in [Bridges](../concepts/bridges.md); the opinion is D-010.

## Main exports

| Export | Kind | Role |
| --- | --- | --- |
| `Locator`, `parseLocator(uri)` | type, function | Scheme, raw string and scheme-specific fields for `https`, `magnet`, `nzb`, `slsk`, `mailto` |
| `Bridge` | interface | `id`, `label`, `schemes`, `exposure`, `availability()`, `resolve(locator, context)` |
| `BridgeContext` | interface | `requester` (identity or `'shell'`), `signal?`, `headers?` |
| `BridgeResult` | type | `{ kind: 'bytes', response }`, `{ kind: 'job', id, label }`, `{ kind: 'conversation', id, participants }` |
| `BridgeExposure` | interface | `revealsAddress`, `encryptedInTransit`, `publicActivity` |
| `BridgeAvailability` | type | `{ available: true }` or `{ available: false, reason }` |
| `BridgeAuthorizer` | type | `(locator, bridge, context) => boolean \| Promise<boolean>`; the shell's consent hook |
| `BridgeRegistry`, `createBridgeRegistry(authorize)` | interface, factory | `register`, `list`, `forScheme`, `resolve` |
| `HttpPolicy`, `HTTP_POLICY`, `createHttpBridge(fetch?, policy?)` | type, const, factory | `https` only, 3 redirects, 10 MiB, 20 s, private-address block |
| `isPrivateAddress(host)` | function | The SSRF check the HTTP bridge applies on every hop |
| `TorrentBackend`, `NzbBackend`, `SoulseekBackend`, `MailBackend` | interface | The backend contracts; see [Add a bridge backend](../how-tos/add-a-bridge-backend.md) |
| `createTorrentBridge(backend?)`, `createNzbBridge(backend?)`, `createSoulseekBridge(backend?)`, `createMailBridge(backend?)` | factory | Report `unavailable:no-backend` without a backend |

## Scope

- Does not implement any transfer protocol. Backends live in the shell app or in packages of their own.
- Does not prompt. Consent is the `BridgeAuthorizer` the shell supplies to the registry.
- Does not apply the guard. Rate limits and the hidden-window allowance run in `@kernl/guard` before a request reaches the registry.
- Does not know about NAP envelopes. `@kernl/core` maps `resource.*` requests onto `BridgeRegistry.resolve`.

## API reference

Generated module: [`_kernl_bridges`](/api/modules/_kernl_bridges.html){target="_self"}
