# Messaging

No encrypted messaging protocol is inherently superior. Each one trades metadata exposure, forward secrecy and reach against the others, and the right trade depends on who the user is writing to. kernl therefore supports several and ranks none ([D-009](../decisions.md#d-009)). A provider describes its own properties truthfully; the shell shows the description and lets the user choose.

In this alpha `private`, `legacy` and `ratchet` work in the live shell when the signed-in account's signer can encrypt; `ratchet` is experimental. The offline preview runs `private` and `legacy` over the in-memory backend, and messages sent there go nowhere; it reports `ratchet` unavailable ([Alpha status](../alpha-status.md#messaging-providers-in-the-live-shell)).

The live shell also runs `group` (group sessions, experimental) for a signed-in account whose signer has `nip44`; the preview reports it as needing a sign-in.

## Protocol inventory

kernl aims to carry every private-messaging protocol that runs over the identity layer, each as one provider behind the same contract ([D-018](../decisions.md#d-018)). This is every messaging NIP in the [NIPs index](https://github.com/nostr-protocol/nips#readme) as of November 2026, plus the two session protocols specified outside it.

| Protocol | Specification | What it is | Status in kernl |
| --- | --- | --- | --- |
| Encrypted direct messages | NIP-04 (deprecated upstream in favour of NIP-17) | Kind 4, shared-secret encryption, sender and recipient public | Shipped: `legacy` |
| Private direct messages | NIP-17, with NIP-44 encryption and NIP-59 gift wrap | Kind 14 rumours sealed and gift-wrapped, one or many recipients | Shipped: `private` (text; kind 15 file messages are not read yet) |
| Double-ratchet sessions | nostr-double-ratchet (draft, outside the NIPs) | One-to-one sessions whose keys change with every message | Shipped: `ratchet`, experimental |
| MLS groups | Marmot protocol (MIP-00 to MIP-03; supersedes NIP-EE, marked unrecommended upstream) | MLS (RFC 9420) groups over kinds 30443, 444 and 445 | Shipped: `group`, experimental |
| Relay-based groups | NIP-29 | Groups a relay enforces; content is readable by the relay, not end-to-end encrypted | Not a provider: no end-to-end encryption, and a group lives on one relay rather than among people, which the `dm` recipient model (people, by public key) does not express. Recorded in [D-018](../decisions.md#d-018) |
| Public chat channels | NIP-28 (unrecommended upstream) | Public channel messages, kind 42 | Not private messaging; out of scope |
| Chats, public messages, voice messages | NIP-C7, NIP-A4, NIP-A0 | Public kinds 9, 24 and 1222 | Not private messaging; out of scope. NIP-C7's kind 9 is the chat convention `group` carries inside its encryption |
| Ephemeral gift wrap | NIP-59 kind 21059 | A gift wrap relays need not store | A transport detail, not a protocol of its own; no provider sends it yet |

## The provider contract

A `MessagingProvider` in `@kernlize/messaging` is a pluggable module with one contract:

```ts
import type { MessagingBackend, ProviderAvailability, SecurityProperties } from '@kernlize/messaging';

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
import type { MessagingBackend, ProviderAvailability } from '@kernlize/messaging';

interface ProviderDeps {
  createBackend: () => MessagingBackend;     // called once per enable; the registry owns the instance
  available: () => ProviderAvailability;     // { available: true } or { available: false, reason }
}
```

The three built-in factories (`createPrivateMessagesProvider`, `createLegacyMessagesProvider`, `createRatchetMessagesProvider`) take the same `ProviderDeps` and supply the definition themselves. In the shell, `@kernlize/core` builds each provider's `ProviderDeps`: `createKernl` supplies `createPrivateMessagesBackend` and `createLegacyMessagesBackend` unless `KernlOptions.messagingBackends` overrides them, and `available` follows the active account ([The shell's backends](#the-shell-s-backends)). In tests and the preview, `createBackend` returns `createMemoryBackend()`. See `providers.feature`, scenario "availability and the backend come from the shell".

## Security properties

`SecurityProperties` is a fixed set of fields. Every field except `specification` is required, and the shell renders them verbatim with no summary score:

| Field | Meaning |
| --- | --- |
| `forwardSecrecy` | Compromise of today's keys does not reveal yesterday's messages. |
| `postCompromiseSecurity` | The session heals after a compromise once both parties exchange messages. |
| `metadataProtection` | `none`, `partial` or `strong`: how much a network observer learns about who talks to whom and when. |
| `requiresSameClient` | The correspondent must use a client that speaks this provider. |
| `groups` | Conversations with more than two participants are supported. |
| `specification` | Optional. Where the protocol is specified. Shown in these docs, not in the public UI. |
| `experimental` | The provider is still changing and may lose history between versions. |

`describeProvider(provider)` turns them into the six rows the picker shows, in this order and with these labels: `Forward secrecy`, `Recovers after a key compromise`, `Metadata protection`, `Correspondent needs the same app`, `Group conversations`, `Experimental`. Booleans render as `yes`/`no`; `metadataProtection` renders as is; `specification` is left out so no protocol name reaches the UI ([D-006](../decisions.md#d-006)).

## The three providers

| Provider id | Name | `specification` | What the specification is | Forward secrecy | Post-compromise security | Metadata protection | Same client required | Groups | Experimental |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `private` | Private messages | `'NIP-17'` | Gift-wrapped private messages: kind 14 rumours sealed in kind 13, wrapped in kind 1059 with a random key | no | no | `partial`: the wrap hides sender and timing from relays, the recipient's inbox relays still see delivery | no | yes | no |
| `legacy` | Legacy messages | `'NIP-04'` | Direct messages: kind 4, shared-secret encryption | no | no | `none`: sender, recipient and timing are public on the event | no | no | no |
| `ratchet` | Ratchet sessions | `'nostr-double-ratchet (draft)'` | A double-ratchet session protocol over nostr, still a draft | yes | yes | `partial`: per-message ephemeral keys hide the long-term identities, relays still see timing | yes | no | yes |
| `group` | Group sessions | `'Marmot (MLS, RFC 9420; supersedes NIP-EE)'` | MLS groups over nostr: key packages (kind 30443), invitations gift-wrapped as kind 444 rumours, group events (kind 445) | yes | yes | `partial`: group events are signed by one-time keys and carry only the group's id, so relays see a group's activity and timing but not its members; a published key package says the account uses group sessions | yes | yes | yes |

The descriptions the picker shows: `private` "Sealed messages that hide who is talking to whom from the network."; `legacy` "The original direct-message format. Readable by the widest range of apps, but who you talk to is visible on the network."; `ratchet` "Per-session keys that change with every message. Both sides need an app that supports it."; `group` "Shared keys that change as the group talks and as people join or leave. Everyone needs an app that supports it."

Three things the table says that the picker says too:

- `legacy` is marked as metadata-exposing because it is. It exists because many correspondents can read nothing else, and the user is told that before choosing it.
- `private` has no forward secrecy. A gift wrap protects metadata, not past messages, and the picker does not claim otherwise.
- `private` and `legacy` are available only while the active account's signer can encrypt: `nip44` for `private`, `nip04` for `legacy`. Otherwise kernl reports `sign-in-required` (nobody is signed in) or `signer-cannot-encrypt` (a read-only account, or a signer without the method).
- `ratchet` is available only when the shell's `available()` says so. The package does not decide the reason; kernl's `createDefaultMessaging` reports `sign-in-required` or `signer-cannot-encrypt` like `private`, because the backend needs `nip44` to seal its state, and `no-runtime` (`MESSAGING_UNAVAILABLE_REASONS.noRuntime`) only when a host registers it without a backend; `enable()` rethrows the reason as `unavailable:<reason>`, and `list()` reports it so the picker can show the provider greyed with that reason. Its specification is a draft and the provider is flagged `experimental`.
- `group` follows the signer the same way (`nip44` opens invitations and seals the library's state) and reports `no-runtime` only when a host registers it without a backend. Its library is an alpha release, so the provider is flagged `experimental`.

## The shell's backends

`@kernlize/core` ships the three network backends the live shell uses ([D-015](../decisions.md#d-015)). Both take the shell's one `EventStore`, `RelayPool` and relay tiers, and read the signer and the user's public key through functions, so they follow the active account without being rebuilt:

- **`createPrivateMessagesBackend`** sends NIP-17 messages. The message is an unsigned kind 14 rumour; it is sealed in a kind 13 event that the account signer signs, encrypting with its `nip44`; the seal is wrapped in a kind 1059 event signed by a one-time key. That key is generated inside an applesauce `PrivateKeySigner`, used for one wrap and discarded; it is never stored. The wrap goes to the recipient's kind 10050 inbox relays, or to the sender's `outbox` and `super` tiers when the recipient publishes none, and a second wrap goes to the sender so their other devices see the message. The backend subscribes to kind 1059 events tagged with the user's public key on the user's own inbox relays, or the same tiers. A conversation id is applesauce's `createConversationIdentifier`: the participants' public keys, the user's included, sorted and joined by `:`, so both sides compute the same id. Decrypted messages are kept in memory per account, never in the `EventStore`, and are cleared when the account changes or signs out; the `EventStore` is read only for inbox relay lists.
- **`createLegacyMessagesBackend`** sends NIP-04 kind 4 messages through `signer.nip04`, with the same conversation ids and message shape. It is the metadata-exposing provider: who writes to whom, and when, is public on the event.
- **`createRatchetMessagesBackend`** runs the `nostr-double-ratchet` library's `NdrRuntime` for the signed-in account ([D-016](../decisions.md#d-016)). The account signer signs the account's device list; the library generates and holds this browser's device key and every per-session ratchet key. Those secrets are written only through `createSealedRatchetStorage`, which encrypts each value to the account with its `nip44` under an opaque slot number, so storage holds no readable key and no correspondent's name. Opening the backend registers this browser as a device and publishes its invite; the other side starts a session from it. Traffic uses the user's `outbox` and `super` tiers, so both sides must share a relay. Sessions are one to one, only chat messages are filed (typing notices and receipts are dropped), and the conversation list is in memory: sessions survive a reload, the list does not.
- **`createGroupMessagesBackend`** runs `@internet-privacy/marmot-ts`, the maintained TypeScript Marmot implementation, for the signed-in account ([D-018](../decisions.md#d-018)). The account signer signs each member's identity proof and key package and opens invitations; the library generates and holds its own MLS signing keys and the group secrets, which move on with every commit. Every store the library keeps is written through `createSealedGroupStore`, which encrypts the whole store to the account with its `nip44`, so storage holds no readable key. Opening the backend publishes a key package (kind 30443) to the user's inbox relays and `outbox` tier, and a fresh one after an invitation uses it up. A send to people goes to the group with exactly those members, else founds one and invites each person by their newest key package; someone with none is refused with `unavailable:recipient-not-ready`. Group events go to the `outbox` and `super` tiers; invitations arrive as gift wraps on the user's inbox relays and are joined as they open. The conversation id is the group id in hex. An account is one member of a group, so only one of a person's devices joins it. Group membership and secrets survive a reload; the messages are kept in memory, so a reload starts each group's history afresh.

kernl holds no key bytes. The private and legacy backends sign and encrypt everything with the account's applesauce signer; the ratchet and group libraries' own keys stay inside the libraries and reach storage only sealed by that signer; an extension or remote signer may ask its own question per decryption, and kernl lets it.

The shell draws no conversation itself. Messages are shown by an applet over the NAP `dm` domain, like any other applet would: see [The Messages applet](#the-messages-applet). An applet reaches messages only through that domain, which is a grant per applet that the user can revoke ([Identity and grants](./identity-and-grants.md)). The shell's own part is what an applet must not decide: which providers are on, in what order, and which one carries a reply.

## The registry

The shell holds exactly one `MessagingRegistry`, built with `createMessagingRegistry({ preferences?, onChange?, askReply? })`. It owns the backend instances:

- `register(provider)` adds a provider at the end of the user's order, unless the saved order already places it. A provider the saved `preferences.enabled` list names is started at once if it is available. One that cannot run yet (nobody is signed in, say) waits: it reports why through `list()`, stays in the saved list, and starts the next time the registry is read after it became available. A second registration of the same id throws `invalid:duplicate-provider`.
- `enable(id)` calls `availability()` and throws `unavailable:<reason>` when the provider cannot run; otherwise it calls `createBackend()` once and keeps the instance. Enabling an enabled provider does nothing. Unknown ids throw `invalid:unknown-provider`.
- `disable(id)` calls the backend's `close?()` and drops it, or forgets a provider that was still waiting.
- `setOrder(ids)` puts the named providers first, in that order; providers left out keep their relative order after them. `list()` returns the providers in the user's order. An unknown id throws `invalid:unknown-provider` and changes nothing.
- **The default is the first enabled provider in the order.** There is no separate default to set. `setDefault(id)` is kept as "move this enabled provider to the top" and throws `invalid:provider-not-enabled` for one that is not running.
- `setReplyRule(rule)` and `forgetReplyChoice(pubkey?)` change how a reply is routed; see [Which provider carries a message](#which-provider-carries-a-message).
- `preferences()` returns a frozen `{ enabled, order, defaultProvider?, reply, replyChoices }` snapshot; `onChange` receives the same snapshot after every change. `enabled` lists what the user wants on, running or waiting. Snapshots saved before there was an order carry only `enabled` and `defaultProvider`, and restore with that default on top.
- `composite()` returns one `MessagingBackend` spanning every running provider, for the NAP `dm` service. It is the same instance on every call and sees providers come and go.
- `close()` closes every backend and leaves the preferences untouched, so a shutdown never erases what the user chose. A closed registry is not reused.

See `registry.feature`, scenarios "the default is the first provider in the order that is enabled", "a waiting provider starts as soon as it can run" and "closing the registry closes every backend and keeps the preferences".

`createDefaultMessaging` in `@kernlize/core` registers `private`, `legacy`, `ratchet` and `group` in that order. For someone who has never chosen, `private` and `legacy` are switched on: they reach anyone with an account, and a message that arrives through either can be read and answered. `ratchet` and `group` publish something about the account when they start, so they wait for the user ([D-027](../decisions.md#d-027)).

## Which provider carries a message

NAP-DM leaves the choice of transport to the runtime, and requires that a runtime with several of them never weakens privacy silently. kernl's rule has two halves ([D-027](../decisions.md#d-027)), both in `reply.feature`:

**Someone new: the order decides.** A `dm.send` that names recipients and no conversation goes to the first enabled provider. When that provider answers `unavailable:recipient-not-ready` (the person has not set it up), the next enabled one is tried, in order; when none can reach them the first refusal is reported. Any other refusal stops the send. Providers ahead of the default are never tried.

**A reply: the correspondent's last provider is offered.** Before a one-to-one message leaves, the composite looks up which enabled provider that person last wrote through (their newest incoming message; a tie goes to the earlier provider in the order). When it is not the provider the message is planned for, the reply rule decides:

| Rule | What happens |
| --- | --- |
| `ask` (the default) | The registry calls `askReply({ peer, theirs, mine })`. The host shows the question; the answer is `{ use: 'theirs' \| 'mine', remember: 'once' \| 'conversation' \| 'always' }`, and `undefined` stops the send with `denied:cancelled`. |
| `theirs` | The reply leaves through the provider they used, without asking. |
| `mine` | The reply leaves through the provider the order picked, without asking. |

An answer kept for the `conversation` is stored per person in `replyChoices` and comes before the rule; `always` makes the answer the rule. `forgetReplyChoice(pubkey)` forgets one person's answer and `forgetReplyChoice()` all of them. Without `askReply` the rule `ask` behaves like `mine`.

The check applies to a send with one recipient other than the owner, and to a send into a `direct` conversation with one other participant: there, a reply moved to their provider is sent to the person, not into the conversation that was named, so its result carries the other provider's conversation id. It never applies to a group conversation, a message to several people, a send that names a `provider`, or when fewer than two providers are running. Someone who never wrote to the user gets the order's provider with no question.

In the shell the question is a dialog: who wrote, through what, what the order would do, the two providers with their descriptions, and whether to keep the answer for this message, this person or everyone. Settings, Messages holds the order, the switches, the rule and the button that forgets kept answers.

## The Messages applet

Pressing **Messages** opens an applet. kernl ships one, `applets/messages` in the repository, built with the napplet toolchain into a single file and listed in `KernlOptions.builtins`, so it opens as `kernl:messages` from bytes pinned by hash, with no lookup ([Applets under kernl](./applets-under-kernl.md), [D-027](../decisions.md#d-027)). It requires only `dm`; `identity`, `theme`, `notify`, `storage` and `keys` are optional and each has a fallback. On its first run `dm`, `identity` and `notify` are switched on, because the applet came with the shell the user is already trusting; each stays a grant the user can withdraw from the window's **Grants**.

The applet shows one thread per person: it merges every `direct` conversation with the same participants, whichever provider each belongs to, and sends a reply to the person without naming a conversation, so the shell's rule above picks the transport. Group conversations stay one thread each and are answered in place. It never parses a conversation id, never learns a provider's name, and counts unread messages itself, because a provider's `unread` number is a lifetime count.

If the user made another installed applet their default for the `dm` role (Applets, Yours), Messages opens that one instead; when it cannot be reached, the shipped applet opens. The count on the Messages button is the shell's own: messages from other people that arrived, after Messages was first opened, while no window showing messages had focus.

## The composite backend

The NAP `dm` domain is a projection over every enabled provider. `createCompositeBackend(resolveEnabled, getDefault, options?)` builds it, and the only thing an applet can observe is the id namespace:

- Every conversation and message id leaving the composite is `"<providerId>:<innerId>"`, built by `namespaceId`. `private:direct:ab,cd` is the conversation `direct:ab,cd` as the `private` provider knows it. The inner id may itself contain `:`; `splitId` splits on the first one only.
- Ids arriving from the applet are split to find the provider. An id without a prefix, or with a prefix no enabled provider owns, rejects with `invalid:unknown-provider`.
- `conversations()` with a cursor routes to the provider named in the cursor and passes the inner cursor through. Without a cursor and with exactly one provider enabled, the provider's page is returned with its cursor namespaced (`private:2`). With several providers, every provider's page is fetched, the conversations are merged and sorted by `updatedAt` descending (conversations without activity sort last), `limit` is applied to the merged list, and the page carries no cursor, because no single provider can resume a merged page.
- `messages()` routes by the conversation prefix and prefixes the ids on the way out.
- `send()` routes by the conversation id when there is one, else by the `provider` field (`WithProvider<DmSendRequest>`) a caller may add, else by the default provider and the order after it. A one-to-one send is first checked against the correspondent's last provider through `options.chooseReply`; see [Which provider carries a message](#which-provider-carries-a-message). An unknown provider rejects with `invalid:unknown-provider`; no default, or a default that is no longer enabled, rejects with `unavailable:no-default-provider`.
- `subscribe()` with a conversation id subscribes on that provider; without one it subscribes on every enabled provider and fans the messages in, prefixed. Subscription ids are `composite-<n>`. Unsubscribing skips providers disabled in the meantime, since disabling already closed their backend, and reports `ok: false` if any surviving provider did.
- `status()` merges: `available` if any provider is, the first `ownerPubkey` found, the union of `implementations` and `capabilities`.
- `close()` on the composite is a no-op. The registry owns backend lifetimes.

Every provider is reachable this way: `kernl.feature` drives the `dm` domain over a real applet port for `ratchet` and for `group` (grant `dm`, then `dm.status`, `dm.send` with `provider`, `dm.subscribe`, `dm.conversations` and `dm.messages`) and checks the provider-namespaced ids. The fields that choose a provider are the `provider` hint on `dm.send` for a new conversation and the `<providerId>:` prefix of `conversationId` everywhere else; `dm.status` lists each enabled provider's implementation (`nip17`, `nip04`, `ndr`, `marmot`).

An applet that uses `dm` therefore sees one inbox. Which provider carries a given conversation is encoded in its id, which an applet treats as opaque; the user sets the order and the reply rule in the shell's settings. See `composite.feature` and `reply.feature`.

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
| `unavailable:recipient-not-ready` | composite `send` to someone new when no enabled provider from the default onward can reach them; the first provider's refusal is passed through |
| `denied:cancelled` | composite `send` when the user dismissed the reply question |
| `invalid:no-recipients`, `invalid:unknown-conversation`, `unavailable:offline` | memory backend `send` |

## Related

- [Add a messaging provider](../how-tos/add-a-messaging-provider.md)
- [`@kernlize/messaging`](../packages/messaging.md)
