# @kernl/messaging

Messaging provider contract, registry and composite direct-message adapter for the kernl shell. Pure: no relay code, no kehto dependency. Backends are injected.

| Field | Value |
| --- | --- |
| Package | `@kernl/messaging` |
| Version | `0.1.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | none |
| Peer dependencies | `@napplet/core >=0.37.0 <0.38.0` (wire types) |
| Side effects | none |

## Install

```bash
pnpm add @kernl/messaging
```

## Purpose

One contract for every private-messaging protocol, truthful self-description instead of ranking, and one composite backend that projects every enabled provider onto the NAP `dm` domain. The concepts are in [Messaging](../concepts/messaging.md); the opinion is D-009.

## Main exports

| Export | Kind | Role |
| --- | --- | --- |
| `MessagingProvider` | interface | `id`, `name`, `description`, `properties`, `availability()`, `createBackend()` |
| `MessagingBackend` | interface | `status`, `conversations`, `messages`, `send`, `subscribe`, `unsubscribe`, `close?`; structurally kehto's `DmAdapter` |
| `SecurityProperties` | interface | `forwardSecrecy`, `postCompromiseSecurity`, `metadataProtection`, `requiresSameClient`, `groups`, `specification?`, `experimental` |
| `ProviderAvailability` | type | `{ available: true }` or `{ available: false, reason }` |
| `MessagingRegistry`, `createMessagingRegistry(preferences?)` | interface, factory | `register`, `list`, `get`, `enable`, `disable`, `setDefault`, `preferences`, `composite`, `close` |
| `ProviderEntry`, `MessagingPreferences` | type | A provider with its registry state; the persisted `{ enabled, defaultProvider }` |
| `createCompositeBackend(resolveEnabled, getDefault)` | function | One backend over every enabled provider, with `provider:innerId` ids |
| `EnabledBackend`, `WithProvider<T>` | type | An enabled provider as the composite sees it; a request that may name a provider |
| `namespaceId(providerId, innerId)`, `splitId(id)`, `NamespacedId` | function, type | The id namespace |
| `createPrivateProvider(deps)`, `createLegacyProvider(deps)`, `createRatchetProvider(deps)` | factory | The three providers; each takes injected dependencies and reports availability from them |

## Scope

- Holds no relay, store or signer. Providers receive what they need from the shell.
- Does not rank, score or recommend. `SecurityProperties` is rendered verbatim.
- Does not translate wire types; `@napplet/core`'s `Dm*` types are used directly.
- Owns backend lifetimes through the registry. The composite's `close()` is a no-op by design.

## API reference

Generated module: [`_kernl_messaging`](/api/modules/_kernl_messaging.html){target="_self"}
