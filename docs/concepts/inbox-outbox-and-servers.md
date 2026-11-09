# Inbox, outbox and finding servers

An account on the network is reached through relays it names itself. This page explains how kernl reads and writes that list, how it helps a person choose relays, and how it reports a publish that some relays refused. The decisions are [D-028](../decisions.md#d-028) and [D-029](../decisions.md#d-029); the exports are listed in [`@kernlize/core`](../packages/core.md#servers-and-mailboxes).

## Inbox and outbox

NIP-65 defines a replaceable event, kind `10002`, in which an account lists its relays as `r` tags. A tag marked `write` is an **outbox**: where the account publishes, and where others read what it wrote. A tag marked `read` is an **inbox**: where others send what mentions or is addressed to the account. An unmarked tag is both. NIP-65 asks clients to keep each list to two to four relays and to spread the event to well-known indexers, so anyone can find it.

In kernl, `Mailboxes` is `{ inboxes, outboxes }`, each a list of normalised relay URLs (`wss://relay.example/`, with the trailing slash applesauce's normaliser adds).

- `mailboxesFromEvent(event)` reads a list. It skips `r` tags whose value is not a `ws:` or `wss:` URL and tags with any marker other than `read` or `write`. It does not use applesauce's `getInboxes`, whose URL check refuses top-level domains longer than six letters.
- `mailboxTags(mailboxes, previous?)` writes one: one `r` tag per relay, collapsed to an unmarked tag when the relay is in both lists, then every non-`r` tag of the previous list unchanged, so a `client` or `alt` tag another app wrote survives. An entry that is not a `ws:`/`wss:` URL throws `invalid:relay-url`.

## The account's list

`createAccountMailboxes({ store, pool, pubkey$, lookupRelays, signer, directory?, patienceMs? })` keeps the active account's list in view.

| State | When | Carries |
| --- | --- | --- |
| `loading` | nobody is signed in, or the lookup has not finished | nothing |
| `missing` | every lookup relay finished without a list, or 15 s passed | `suggested` inboxes and outboxes |
| `found` | a list is in the store, from the lookup, another app or a save | `mailboxes` and the `event` |

1. For each value of `pubkey$` it opens one subscription for `{ kinds: [10002], authors: [pubkey] }` on `lookupRelays()` and adds what arrives to the event store, which keeps the newest version. The subscription stays open, so a list saved from another app replaces the one shown.
2. The state is `loading` until a list is in the store or every lookup relay has finished: sent EOSE, closed the subscription or failed. Only then is it `missing`. A relay that accepts the connection and never answers would hold `loading` forever, so `patienceMs` (15 s) is the cap; it is the only clock, and it is long on purpose.
3. A `missing` state carries `suggested` inboxes and outboxes: three of each from `directory.suggest`, or the built-in fallback without a directory. When the directory learns more while the list is missing, the suggestions follow.
4. With nobody signed in the state stays `loading`. When `pubkey$` completes the subscription closes.

`save(next)` signs and publishes the new list:

- The signer comes from `signer()`; without one, `save` rejects with `denied:read-only` before anything is built.
- The tags come from `mailboxTags(next, previous)`, the content is the previous list's, and `created_at` is later than the previous list's even when the device clock is behind.
- It goes to the new outboxes, the old outboxes, the new inboxes and the lookup relays, deduplicated. The old outboxes are where readers looked for the account until now; the lookup relays are the indexers NIP-65 asks for.
- The answer is a `PublishOutcome` (below). When at least one relay accepted, the event is added to the store and the state becomes `found`. When none did, the store keeps the old list, so the state never shows a list no relay holds.

## The directory

NIP-66 monitors probe relays and publish what they find as kind `30166` events, one per relay per monitor, with the relay's URL in the `d` tag and tags for round-trip times (`rtt-open`, `rtt-read`, `rtt-write`), the network (`n`), supported NIPs (`N`), relay types (`T`), requirements (`R`, with `!` for "not required") and accepted kinds (`k`).

`createRelayDirectory({ pool, relays?, maxAgeSeconds?, now?, fallback?, throttleMs? })` reads those reports.

- **Streaming.** `start()` opens one `pool.subscription` on the monitor relays, `DEFAULT_MONITOR_RELAYS` unless `relays` names others (an array, or an Observable when the list changes), for `{ kinds: [30166], '#n': ['clearnet'], since: now - maxAgeSeconds }`. The window is two days. `stop()` closes the subscription and keeps what was learned; `start()` again reopens it.
- **Networks.** A browser dials only clearnet relays, and NIP-66 says a report should name its network, so the filter asks the relays for clearnet reports only. A relay that ignores the filter is checked again in the directory: a report naming another network is dropped, a report naming none is kept. A `d` tag that is not a `ws:`/`wss:` URL, such as a relay known only by its pubkey, is dropped.
- **Aggregation.** For each relay, each monitor's newest report counts. A `RelayListing` has `monitors` (distinct monitor keys within the window), `lastSeen` (the newest report), mean `rttOpen`, `rttRead` and `rttWrite` over the monitors that measured them, the newest report's `network`, the union of `nips` and `types`, and `requiresAuth`, `requiresPayment` and `restrictedWrites` from the newest report's `R` tags. A report that ages out of the window drops out of the listings on the next read.
- **Emissions.** `listings$` replays the current list and emits again at most every `throttleMs` (250 ms) while reports stream in, so a view can follow the directory filling without redrawing on every event. `listings()` is the same list, computed on demand.

### Search

`search(text, limit = 10)` is for completing a relay field as the person types. Case is ignored and a trailing slash is dropped.

| Typed | Matches | Example |
| --- | --- | --- |
| a word | the start of the address or of any word in it (split at `.`, `-`, `/`) first, then anywhere in it | `damus` finds `relay.damus.io` and `damus.example.org` |
| with a scheme | only addresses that start with what follows the scheme | `wss://nos` finds `nos.lol` and `nostr.wine`, not `relay.nostr.band` |
| nothing | every listing | the best-ranked relays |

Within a match strength, more monitors rank first, then a quicker `rttOpen`.

### Suggestions

`suggest({ purpose, exclude?, limit = 3 })` picks relays for one purpose.

| Purpose | Leaves out | Prefers |
| --- | --- | --- |
| `inbox`, `outbox` | relays that require a login or payment, or restrict who may write | — |
| `lookup` | relays that require a login or payment | indexers only: NIP-65 support, a type containing `Indexer`, or accepted kind `0` or `10002` |

Candidates rank by the number of monitors, then by the hour they were last seen, then by connection time. `exclude` removes relays already chosen. When fewer than `limit` remain, the answer is topped up from the fallback, skipping any fallback relay the directory knows to fail the filter; a fallback relay appears with `monitors: 0`.

| Purpose | Built-in fallback (`DEFAULT_SUGGESTIONS`) |
| --- | --- |
| `inbox`, `outbox` | `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.primal.net` |
| `lookup` | `wss://purplepag.es`, `wss://user.kindpag.es`, `wss://indexer.coracle.social` |

`fallback` replaces these: one list for every purpose, or one per purpose.

### What the directory does not do

NIP-66 says clients must work without these events and should not trust a single monitor. The directory follows both. It never blocks a connection or removes a relay the person chose, and with no report at all `suggest` still answers. Counting distinct monitors rewards agreement, but anyone can sign reports under many keys, so the count orders suggestions and nothing more. A single monitor's newest report can mark a relay as requiring payment and drop it from suggestions; the person can still type it.

## Publish outcomes

A publish goes to several relays and each answers for itself. `summarizePublish(responses)` takes the `PublishResponse[]` that `RelayPool.publish` resolves with and returns a `PublishOutcome`:

```ts
import { describeOutcome, summarizePublish } from '@kernlize/core';

const outcome = summarizePublish([
  { ok: true, from: 'wss://a.example' },
  { ok: true, from: 'wss://b.example' },
  { ok: false, from: 'wss://c.example', message: 'blocked: spam' },
]);
outcome.ok; // true
outcome.refused; // [{ url: 'wss://c.example/', reason: 'blocked: spam' }]
describeOutcome(outcome); // 'Saved to 2 of 3 servers'
```

`ok` is true when any relay accepted. A relay that answered twice counts once and an acceptance wins. `describeOutcome` gives the person one of four sentences and never the relay's reason, which is written for developers and often names the protocol ([Public vocabulary](../policies/public-vocabulary.md)).

| Outcome | Sentence |
| --- | --- |
| no relay was asked | There was no server to save it to |
| none accepted | No server accepted it |
| some accepted | Saved to 2 of 3 servers |
| all accepted | Saved to all 3 servers (Saved to 1 server for one) |

## Wiring

`createKernl` composes both over the shell's pool and store: `kernl.mailboxes` follows the active account, and its outboxes become the `outbox` tier while a list is found; `kernl.directory` is idle until the host calls `start()` (the shell's Settings does while it is open). A host that composes its own shell, or wants a second directory with other monitors, builds them the same way:

```ts
import { createAccountMailboxes, createRelayDirectory, describeOutcome, type MailboxSigner, type RelayTiers } from '@kernlize/core';
import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';
import type { Observable } from 'rxjs';

declare const pool: RelayPool;
declare const eventStore: EventStore;
declare const tiers: RelayTiers;
declare const pubkey$: Observable<string | undefined>;
declare const activeSigner: MailboxSigner | undefined;

const directory = createRelayDirectory({ pool });
directory.start();
const mailboxes = createAccountMailboxes({
  store: eventStore,
  pool,
  pubkey$,
  lookupRelays: () => tiers.get().discovery,
  signer: () => activeSigner,
  directory,
});

const outcome = await mailboxes.save({ inboxes: ['wss://in.example'], outboxes: ['wss://out.example'] });
describeOutcome(outcome); // 'Saved to 3 of 4 servers', say
```

## Related

- [Relay tiers](./relay-tiers.md)
- [Identity and grants](./identity-and-grants.md)
- [Error reasons](../reference/errors.md)
