# @kernl/messaging

Messaging provider contract, registry, composite direct-message backend and an in-memory backend for the kernl shell. Pure: no relay code, no signer, no kehto dependency. Providers receive their backend constructor from the shell.

::: info Network backends live in `@kernl/core`
This package ships no backend that sends anything over a network; the only backend in it is `createMemoryBackend`. The network backends for `private` and `legacy` are `createPrivateMessagesBackend` and `createLegacyMessagesBackend` in [`@kernl/core`](./core.md#messaging-backends), because they need the shell's event store, connection pool and account signer. `createKernl` wires them by default, so both providers work in the live shell while the signed-in account's signer can encrypt; `ratchet` stays unavailable with `no-runtime` ([Alpha status](../alpha-status.md#messaging-providers-in-the-live-shell)). The offline preview (`?preview=1`) runs the same providers over the in-memory backend with a scripted correspondent, so messages sent there go nowhere.
:::

| Field | Value |
| --- | --- |
| Package | `@kernl/messaging` |
| Version | `0.1.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | none |
| Peer dependencies | `@napplet/core >=0.37.0 <0.38.0` (the `Dm*` wire types) |
| Side effects | none |

## Install

`@kernl/messaging` is not yet published to npm, so `pnpm add @kernl/messaging` fails. During the alpha it is built from the kernl source repository, which is private, and consumed as a workspace dependency. The [package index](./index.md#install) has the steps.

```json
{ "dependencies": { "@kernl/messaging": "workspace:^" } }
```

## Purpose

One contract for every private-messaging protocol, truthful self-description instead of ranking, and one composite backend that projects every enabled provider onto the NAP `dm` domain. The concepts are in [Messaging](../concepts/messaging.md); the opinion is [D-009](../decisions.md#d-009).

## Exports

### Contract

| Export | Signature | Description |
| --- | --- | --- |
| `MessagingProvider` | interface | `{ id; name; description; properties: SecurityProperties; availability(): ProviderAvailability; createBackend(): MessagingBackend }`. `id` is the conversation-id prefix. |
| `MessagingBackend` | interface | `status()`, `conversations(query?)`, `messages(query)`, `send(request)`, `subscribe(request, onMessage)`, `unsubscribe(subscriptionId)`, `close?()`. Every method except `send` may return synchronously or a promise. Structurally kehto's `DmAdapter`. |
| `SecurityProperties` | interface | `forwardSecrecy`, `postCompromiseSecurity`, `metadataProtection: 'none' \| 'partial' \| 'strong'`, `requiresSameClient`, `groups`, `specification?`, `experimental`. |
| `ProviderAvailability` | union | `{ available: true }` or `{ available: false; reason: string }`. The reason is a bare word such as `sign-in-required`; the registry prefixes it as `unavailable:<reason>`. |
| `ProviderEntry` | interface | `{ provider; enabled: boolean; availability: ProviderAvailability }`, what `MessagingRegistry.list()` and `get()` return. |
| `MessagingPreferences` | interface | `{ enabled: readonly string[]; defaultProvider?: string }`, the persisted registry state. |
| `PACKAGE_NAME` | `'@kernl/messaging'` | The package name as a constant. |

### Registry

| Export | Signature | Description |
| --- | --- | --- |
| `createMessagingRegistry` | `(options?: MessagingRegistryOptions) => MessagingRegistry` | One per shell. Owns one backend per enabled provider, restores saved preferences lazily as providers register, and hands out one stable composite backend. |
| `MessagingRegistryOptions` | interface | `{ preferences?: MessagingPreferences; onChange?: (preferences: MessagingPreferences) => void }`. `onChange` receives a frozen snapshot after every change. |
| `MessagingRegistry` | interface | `register(provider)`, `list()`, `get(id)`, `enable(id)`, `disable(id)`, `setDefault(id)`, `preferences()`, `composite()`, `close()`. Error reasons: `invalid:duplicate-provider`, `invalid:unknown-provider`, `unavailable:<reason>`, `invalid:provider-not-enabled`. |

### Composite backend

| Export | Signature | Description |
| --- | --- | --- |
| `createCompositeBackend` | `(resolveEnabled: () => readonly EnabledBackend[], getDefault: () => string \| undefined) => MessagingBackend` | One backend over every enabled provider. Ids leaving it are `<providerId>:<innerId>`; ids arriving are routed by prefix. Rules for cursors, sends and subscriptions are in [Messaging](../concepts/messaging.md#the-composite-backend). |
| `EnabledBackend` | interface | `{ id: string; backend: MessagingBackend }`. |
| `WithProvider<T>` | type | `T & { provider?: string }`: a `DmSendRequest` that names the provider for a new conversation. |
| `namespaceId` | `(providerId: string, innerId: string) => string` | `'private:direct:ab,cd'`. |
| `splitId` | `(id: string) => NamespacedId \| undefined` | Splits on the first `:`; `undefined` when there is no prefix. |
| `NamespacedId` | interface | `{ providerId: string; innerId: string }`. |

### In-memory backend

| Export | Signature | Description |
| --- | --- | --- |
| `createMemoryBackend` | `(options?: MemoryBackendOptions) => MemoryBackend` | A complete backend in memory for tests and the shell's offline preview. Conversations are keyed `direct:<pubkey>` or `group:<pubkey>,<pubkey>` over the sorted correspondents; cursors are numeric offsets; unread is the count of `received` messages. |
| `MemoryBackendOptions` | interface | `{ owner?: string (default 'owner'); available?: boolean (default true); now?: () => number }`. `now` is in Unix seconds and defaults to the wall clock. |
| `MemoryBackend` | interface | `MessagingBackend` plus `deliver(incoming: MemoryIncoming): DmMessage` (stores a `received` message and notifies matching subscribers) and a non-optional `close()` that drops every subscriber. |
| `MemoryIncoming` | interface | `{ senderPubkey; content; conversationId?; createdAt? }`. Without `conversationId` the message lands in `direct:<senderPubkey>`. |

`send()` rejects with `invalid:no-recipients` when neither a conversation nor a recipient other than the owner is named, `invalid:unknown-conversation` for an id the backend has never seen, and `unavailable:offline` while `available` is false. Reads keep working offline.

### Providers

| Export | Signature | Description |
| --- | --- | --- |
| `createPrivateMessagesProvider` | `(deps: ProviderDeps) => MessagingProvider` | Id `private`, name "Private messages". NIP-17. |
| `createLegacyMessagesProvider` | `(deps: ProviderDeps) => MessagingProvider` | Id `legacy`, name "Legacy messages". NIP-04. |
| `createRatchetMessagesProvider` | `(deps: ProviderDeps) => MessagingProvider` | Id `ratchet`, name "Ratchet sessions". nostr-double-ratchet draft; `experimental: true`. |
| `defineProvider` | `(definition: ProviderDefinition, deps: ProviderDeps) => MessagingProvider` | Joins fixed copy and properties with the shell's backend constructor and availability check. The three built-ins are made with it. |
| `ProviderDeps` | interface | `{ createBackend: () => MessagingBackend; available: () => ProviderAvailability }`. |
| `ProviderDefinition` | interface | `{ id; name; description; properties: SecurityProperties }`. |
| `describeProvider` | `(provider: MessagingProvider) => readonly ProviderDescriptionRow[]` | Six label/value rows for the picker, in a fixed order; `specification` is left out so no protocol name reaches the UI. |
| `ProviderDescriptionRow` | interface | `{ label: string; value: string }`. |

## Example

```ts
import { createCompositeBackend, createMemoryBackend, createMessagingRegistry, createPrivateMessagesProvider } from '@kernl/messaging';

const backend = createMemoryBackend({ owner: 'me', now: () => 1_700_000_000 });
await backend.send({ recipients: ['alice'], content: 'hi' });
backend.deliver({ senderPubkey: 'alice', content: 'hello' });

const registry = createMessagingRegistry({ onChange: (prefs) => console.log(prefs) });
registry.register(createPrivateMessagesProvider({ createBackend: () => backend, available: () => ({ available: true }) }));
registry.enable('private');
registry.setDefault('private');

const page = await registry.composite().conversations({ limit: 20 });
page.conversations[0]?.id; // 'private:direct:alice'

// the same composite, assembled by hand
createCompositeBackend(() => [{ id: 'private', backend }], () => 'private');
```

## Scope

- Holds no relay, store or signer. The shell passes a `createBackend` function; what it closes over is the shell's business.
- Does not rank, score or recommend. `SecurityProperties` is rendered verbatim by `describeProvider`.
- Does not translate wire types; `@napplet/core`'s `Dm*` types are used directly.
- Owns backend lifetimes through the registry. The composite's `close()` is a no-op by design.

## Specification

`packages/messaging/features/`: `registry.feature`, `composite.feature`, `memory-backend.feature`, `providers.feature`.

## API reference

Generated module: [`_kernl_messaging`](../api/modules/_kernl_messaging.html){target="_self"}
