# Messaging

No encrypted messaging protocol is inherently superior. Each one trades metadata exposure, forward secrecy and reach against the others, and the right trade depends on who the user is writing to. kernl therefore supports several and ranks none (D-009). A provider describes its own properties truthfully; the shell shows the description and lets the user choose.

## The provider contract

A `MessagingProvider` in `@kernl/messaging` is a pluggable module with one contract:

```ts
interface MessagingProvider {
  readonly id: string;              // conversation-id prefix: 'private', 'legacy', 'ratchet'
  readonly name: string;            // user-facing, no protocol vocabulary
  readonly description: string;     // one sentence for the picker
  readonly properties: SecurityProperties;
  availability(): ProviderAvailability;
  createBackend(): MessagingBackend;
}
```

`createBackend()` returns a `MessagingBackend`: `status`, `conversations`, `messages`, `send`, `subscribe`, `unsubscribe` and an optional `close`. The shape is structurally identical to kehto's `DmAdapter`, so a backend can be handed to `createDmService` without translation while this package stays free of a kehto dependency. The wire types (`DmConversation`, `DmMessage`, `DmSendRequest` and friends) come from `@napplet/core`. Every method except `send` may return a value or a promise.

The package holds no relay code, signer or store. A provider is built with `defineProvider(definition, deps)`, where `definition` is the fixed, user-facing part (`id`, `name`, `description`, `properties`) and `deps` is what the shell injects:

```ts
interface ProviderDeps {
  createBackend: () => MessagingBackend;     // called once per enable; the registry owns the instance
  available: () => ProviderAvailability;     // { available: true } or { available: false, reason }
}
```

The three built-in factories (`createPrivateMessagesProvider`, `createLegacyMessagesProvider`, `createRatchetMessagesProvider`) take the same `ProviderDeps` and supply the definition themselves. In the shell, `@kernl/core` closes `createBackend` over the applesauce store, pool and active signer; in tests it returns `createMemoryBackend()`. See `providers.feature`, scenario "availability and the backend come from the shell".

## Security properties

`SecurityProperties` is a fixed set of fields. Every provider fills in every field, and the shell renders them verbatim with no summary score:

| Field | Meaning |
| --- | --- |
| `forwardSecrecy` | Compromise of today's keys does not reveal yesterday's messages. |
| `postCompromiseSecurity` | The session heals after a compromise once both parties exchange messages. |
| `metadataProtection` | `none`, `partial` or `strong`: how much a network observer learns about who talks to whom and when. |
| `requiresSameClient` | The correspondent must use a client that speaks this provider. |
| `groups` | Conversations with more than two participants are supported. |
| `specification` | Where the protocol is specified. Shown in these docs, not in the public UI. |
| `experimental` | The provider is still changing and may lose history between versions. |

`describeProvider(provider)` turns them into the six rows the picker shows, in this order and with these labels: `Forward secrecy`, `Recovers after a key compromise`, `Metadata protection`, `Correspondent needs the same app`, `Group conversations`, `Experimental`. Booleans render as `yes`/`no`; `metadataProtection` renders as is; `specification` is left out so no protocol name reaches the UI (D-006).

## The three providers

| Provider id | Name | Protocol (`specification`) | Forward secrecy | Post-compromise security | Metadata protection | Same client required | Groups | Experimental |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `private` | Private messages | NIP-17 gift-wrapped private messages (kind 14 rumours sealed in kind 13, wrapped in kind 1059 with a random key) | no | no | `partial`: the wrap hides sender and timing from relays, the recipient's inbox relays still see delivery | no | yes | no |
| `legacy` | Legacy messages | NIP-04 direct messages (kind 4, shared-secret encryption) | no | no | `none`: sender, recipient and timing are public on the event | no | no | no |
| `ratchet` | Ratchet sessions | nostr-double-ratchet (draft) | yes | yes | `partial`: per-message ephemeral keys hide the long-term identities, relays still see timing | yes | no | yes |

The descriptions the picker shows: `private` "Sealed messages that hide who is talking to whom from the network."; `legacy` "The original direct-message format. Readable by the widest range of apps, but who you talk to is visible on the network."; `ratchet` "Per-session keys that change with every message. Both sides need an app that supports it."

Three things the table says that the picker says too:

- `legacy` is marked as metadata-exposing because it is. It exists because many correspondents can read nothing else, and the user is told that before choosing it.
- `private` has no forward secrecy. A gift wrap protects metadata, not past messages, and the picker does not claim otherwise.
- `ratchet` is available only when the shell's `available()` says so. The package does not decide the reason; kernl's `createDefaultMessaging` supplies `no-runtime` (`MESSAGING_UNAVAILABLE_REASONS.ratchet`), `enable()` rethrows it as `unavailable:no-runtime`, and `list()` reports it so the picker can show the provider greyed with that reason. Its specification is a draft and the provider is flagged `experimental`.

## The registry

The shell holds exactly one `MessagingRegistry`, built with `createMessagingRegistry({ preferences?, onChange? })`. It owns the backend instances:

- `register(provider)` adds a provider. Nothing is enabled by registration unless the saved `preferences.enabled` list names the provider; then it is enabled at once if available, and left disabled (reporting why through `list()`) if not. A second registration of the same id throws `invalid:duplicate-provider`.
- `enable(id)` calls `availability()` and throws `unavailable:<reason>` when the provider cannot run; otherwise it calls `createBackend()` once and keeps the instance. Enabling an enabled provider does nothing. Unknown ids throw `invalid:unknown-provider`.
- `disable(id)` calls the backend's `close?()` and drops it. If the default pointed at it, the default is cleared.
- `setDefault(id)` names the provider for sends that name no provider and no conversation. The provider must be enabled, else `invalid:provider-not-enabled`. A saved `defaultProvider` is restored when that provider registers, unless `setDefault` was called first.
- `preferences()` returns a frozen `{ enabled, defaultProvider? }` snapshot; `onChange` receives the same snapshot after every change.
- `composite()` returns one `MessagingBackend` spanning every enabled provider, for the NAP `dm` service. It is the same instance on every call and sees providers come and go.
- `close()` closes every backend and leaves the preferences untouched, so a shutdown never erases what the user chose. A closed registry is not reused.

See `registry.feature`, scenarios "saved preferences enable providers as they register" and "closing the registry closes every backend and keeps the preferences".

## The composite backend

The NAP `dm` domain is a projection over every enabled provider. `createCompositeBackend(resolveEnabled, getDefault)` builds it, and the only thing an applet can observe is the id namespace:

- Every conversation and message id leaving the composite is `"<providerId>:<innerId>"`, built by `namespaceId`. `private:direct:ab,cd` is the conversation `direct:ab,cd` as the `private` provider knows it. The inner id may itself contain `:`; `splitId` splits on the first one only.
- Ids arriving from the applet are split to find the provider. An id without a prefix, or with a prefix no enabled provider owns, rejects with `invalid:unknown-provider`.
- `conversations()` with a cursor routes to the provider named in the cursor and passes the inner cursor through. Without a cursor and with exactly one provider enabled, the provider's page is returned with its cursor namespaced (`private:2`). With several providers, every provider's page is fetched, the conversations are merged and sorted by `updatedAt` descending (conversations without activity sort last), `limit` is applied to the merged list, and the page carries no cursor, because no single provider can resume a merged page.
- `messages()` routes by the conversation prefix and prefixes the ids on the way out.
- `send()` routes by the conversation id when there is one, else by the `provider` field (`WithProvider<DmSendRequest>`) the shell adds when the user picks a provider for a new conversation, else by the default provider. An unknown provider rejects with `invalid:unknown-provider`; no default, or a default that is no longer enabled, rejects with `unavailable:no-default-provider`.
- `subscribe()` with a conversation id subscribes on that provider; without one it subscribes on every enabled provider and fans the messages in, prefixed. Subscription ids are `composite-<n>`. Unsubscribing skips providers disabled in the meantime, since disabling already closed their backend, and reports `ok: false` if any surviving provider did.
- `status()` merges: `available` if any provider is, the first `ownerPubkey` found, the union of `implementations` and `capabilities`.
- `close()` on the composite is a no-op. The registry owns backend lifetimes.

An applet that uses `dm` therefore sees one inbox. Which provider carries a given conversation is visible in its id, and the shell shows it as a label the user can change for new conversations. See `composite.feature`.

## The in-memory backend

`createMemoryBackend({ owner?, available?, now? })` is a complete `MessagingBackend` with no network, used by the shell's offline preview and by every feature in this package. Conversations are keyed `direct:<pubkey>` or `group:<pubkey>,<pubkey>` over the sorted correspondents with the owner removed; `send()` stores the message as `sent` (id `msg-<n>`, or the request's `clientMessageId`) and notifies subscribers; `deliver({ senderPubkey, content, conversationId?, createdAt? })` plays the other side and stores a `received` message; unread counts are the number of `received` messages; cursors are numeric offsets with default page sizes of 50 conversations and 100 messages. `send()` rejects with `invalid:no-recipients`, `invalid:unknown-conversation` or `unavailable:offline`; reads keep working offline so a preview can still show history. See `memory-backend.feature`.

## Error reasons

| Reason | Thrown by |
| --- | --- |
| `invalid:duplicate-provider` | `register` |
| `invalid:unknown-provider` | `enable`, `disable` (unknown id); composite routing of ids, cursors and `provider` hints |
| `unavailable:<reason>` | `enable` when `availability()` is false; `<reason>` is the shell's word |
| `invalid:provider-not-enabled` | `setDefault` |
| `unavailable:no-default-provider` | composite `send` with no conversation, no hint and no usable default |
| `invalid:no-recipients`, `invalid:unknown-conversation`, `unavailable:offline` | memory backend `send` |

## Related

- [Add a messaging provider](../how-tos/add-a-messaging-provider.md)
- [`@kernl/messaging`](../packages/messaging.md)
