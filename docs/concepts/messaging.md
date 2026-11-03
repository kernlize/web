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

`createBackend()` returns a `MessagingBackend`: `status`, `conversations`, `messages`, `send`, `subscribe`, `unsubscribe` and an optional `close`. The shape is structurally identical to kehto's `DmAdapter`, so a backend can be handed to `createDmService` without translation while this package stays free of a kehto dependency. The wire types (`DmConversation`, `DmMessage`, `DmSendRequest` and friends) come from `@napplet/core`.

In the first draft the backends are injected: the shell constructs each provider with the applesauce `EventStore`, `RelayPool` and active signer it needs, and the package itself holds no relay code. That keeps `@kernl/messaging` pure and lets the same provider run against a test double.

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

## The three providers

| Provider id | Protocol | Forward secrecy | Post-compromise security | Metadata protection | Same client required | Groups | Experimental |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `private` | NIP-17 gift-wrapped private messages (kind 14 rumours sealed in kind 13, wrapped in kind 1059 with a random key) | no | no | `partial`: the wrap hides sender and timing from relays, the recipient's inbox relays still see delivery | no | yes | no |
| `legacy` | NIP-04 direct messages (kind 4, shared-secret encryption) | no | no | `none`: sender, recipient and timing are public on the event | no | no | no |
| `ratchet` | Nostr double-ratchet sessions (draft) | yes | yes | `partial`: per-message ephemeral keys hide the long-term identities, relays still see timing | yes | no | yes |

Three things the table says that the picker says too:

- `legacy` is marked as metadata-exposing because it is. It exists because many correspondents can read nothing else, and the user is told that before choosing it.
- `private` has no forward secrecy. A gift wrap protects metadata, not past messages, and the picker does not claim otherwise.
- `ratchet` is available only when its runtime is supplied to the shell. Until then `availability()` returns `{ available: false, reason: 'unavailable:ratchet-runtime' }` and the picker shows it greyed with that reason. Its specification is a draft and the provider is flagged `experimental`.

## The registry

The shell holds exactly one `MessagingRegistry`. It owns the backend instances:

- `register(provider)` adds a provider; nothing is enabled by registration.
- `enable(id)` calls `availability()` and throws `unavailable:<reason>` when the provider cannot run; otherwise it calls `createBackend()` once and keeps the instance.
- `disable(id)` closes and drops that backend.
- `setDefault(id)` names the provider for sends that name no provider and whose recipient has no history.
- `preferences()` returns `{ enabled, defaultProvider }` for persistence.
- `composite()` returns one `MessagingBackend` spanning every enabled provider, for the NAP `dm` service.
- `close()` closes every backend.

## The composite adapter

The NAP `dm` domain is a projection over every enabled provider. `createCompositeBackend(resolveEnabled, getDefault)` builds it, and the only thing an applet can observe is the id namespace:

- Every conversation and message id leaving the composite is `"<providerId>:<innerId>"`, built by `namespaceId`. `private:direct:ab,cd` is the conversation `direct:ab,cd` as the `private` provider knows it. The inner id may itself contain `:`; `splitId` splits on the first one only.
- Ids arriving from the applet are split to find the provider. An unknown prefix rejects with `invalid:unknown-provider`.
- `conversations()` with no cursor merges every provider's page and sorts by `updatedAt`. A cursor is produced only when exactly one provider is involved, namespaced the same way, because no single provider can resume a merged page.
- `send()` routes by the conversation id when there is one, else by an explicit `provider` field the shell adds when the user picks a provider for a new conversation, else by the default provider. With no default it rejects with `unavailable:no-default-provider`.
- `subscribe()` with a conversation id subscribes on that provider; without one it subscribes on every enabled provider and fans the messages in. Unsubscribing skips providers disabled in the meantime, since disabling already closed their backend.
- `status()` merges: `available` if any provider is, the union of `implementations` and `capabilities`.
- `close()` on the composite is a no-op. The registry owns backend lifetimes.

An applet that uses `dm` therefore sees one inbox. Which provider carries a given conversation is visible in its id, and the shell shows it as a label the user can change for new conversations.

## Related

- [Add a messaging provider](../how-tos/add-a-messaging-provider.md)
- [`@kernl/messaging`](../packages/messaging.md)
