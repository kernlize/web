# Spec conformance

kernl conforms to specifications it does not own. This page says which ones, what "upstream first" means in practice, and how a gap is recorded.

## Authority

| Area | Authority | Local copy |
| --- | --- | --- |
| Shell–applet protocol | NIP-5D, [nostr-protocol/nips PR #2303](https://github.com/nostr-protocol/nips/pull/2303) | none |
| NAP domains (`relay`, `outbox`, `dm`, `resource`, …) | [napplet/naps](https://github.com/napplet/naps) | none |
| Download domains (`torrent`, `nzb`, `soulseek`) | The drafts NAP-TORRENT ([napplet/naps PR #72](https://github.com/napplet/naps/pull/72)), NAP-NZB ([#136](https://github.com/napplet/naps/pull/136)) and NAP-SOULSEEK ([#135](https://github.com/napplet/naps/pull/135)) | none |
| Wire types and dispatch | [`@napplet/core`](https://www.npmjs.com/package/@napplet/core), pinned `>=0.41.0 <0.42.0` | the installed package |
| Shell composition | kehto source, `@kehto/*` at the pinned ranges | the installed packages |
| Event layer | applesauce v7, [applesauce.build](https://applesauce.build) | the installed packages |
| Messaging protocols | NIP-17, NIP-04, the nostr double-ratchet draft, as named in each provider's `specification` | none |

kernl keeps no local copy of a specification text. A copy drifts; a link does not. When the PR or a NAP document changes, the behaviour changes in kernl in a pull request that cites the clause.

## The download drafts

kernl serves three drafts that are not merged upstream, each by driving a program the person runs, not by being an engine ([D-050](../decisions.md#d-050)). Each draft allows that. A remote control cannot reach the files the program wrote, so each service refuses the operations that need them, in the draft's own terms, and says so in its discovery call. This table is the whole list of refusals and deviations; the codes are in [Error reasons](../reference/errors.md#download-programs).

| Draft | What kernl refuses | What else differs |
| --- | --- | --- |
| NAP-TORRENT, [PR #72](https://github.com/napplet/naps/pull/72) | `pickFiles`, `read`, `exportMetainfo`, `saveFile` and `openFile` answer `unsupported`. `capabilities` reports `canSaveFiles`, `canOpenFiles` and `canSeedRuntimeFiles` false, `createFormats` empty, `formats` `v1` only, and the read limits at 1, the smallest the schema allows. `add` refuses mode `seed` (`unsupported-mode`), a `runtime-file-set` source (`unsupported-source`), v2-only sources (`unsupported-format`), `storage` other than `persistent` (`storage-denied`), `trackers` and `webSeeds` (`unsupported-setting`) and `fileSelection` (`unsupported`; `selectFiles` works once the list is known). | `cancel` always answers `cancelled: false`: nothing an applet could cancel is ever pending. With no program set up, `capabilities` reports empty `transports` and `modes`. `metadata` gives a magnet link with no tracker in it. A program's own error text is not passed on, because it can hold a tracker address with a passkey. The wire types come from `@napplet/core`. |
| NAP-NZB, [PR #136](https://github.com/napplet/naps/pull/136) | `files` and `read` answer `unsupported`. Every downloader and every job reports `canReadFiles: false`, and `maxReadBytes` is 0. A downloader's `actions` leave out what its program cannot do: SABnzbd has no `cancel`. | `@napplet/core` 0.41 publishes no NAP-NZB types, so the wire shapes are written out from the draft's tables in `packages/core/src/downloads/nzb-wire.ts`, to be replaced when upstream ships them. The draft's `file_changed`, `invalid_range`, `not_ready` and `mutation_failed` codes are never answered. A `url` source is offered only when the shell can fetch: in the composed shell through the HTTP bridge, `https` only. |
| NAP-SOULSEEK, [PR #135](https://github.com/napplet/naps/pull/135) | `save` answers `unsupported` and `info` reports `canSave: false`. `read` answers `denied` for a finished download: the shell cannot disclose bytes it cannot reach. | slskd has no search aimed at one peer, so a search with `username` is a network search with the other peers' answers left out. slskd cannot pause a transfer, so `pause` stops it in the daemon and `resume` asks for the file again. slskd keeps a search's answers until the search ends, so results arrive when collecting completes. The wire types come from `@napplet/core`. |

The three domains are not kehto domains. kehto's runtime admits each by the environment the window was mounted with and the service's own `messageCapabilities`, and an applet can call them only when the prelude is given a binding table ([kehto/web#413](https://github.com/kehto/web/pull/413)); until a released `@kehto/shell` renders one, kernl does not offer them ([Alpha status](../alpha-status.md#upstream-gaps)).

## Upstream first

When kernl needs something a specification or an upstream package does not provide, the order is:

1. **Compose it from what exists.** Most of kernl is this: the guard composes `@kehto/rate-limit/legacy`'s `evaluate()` and kehto's `filterNappletMessage`, the restrictive posture composes `aclDefaultPolicy`, `resolveEnvironment` and `aclState.grant`.
2. **Propose it upstream.** An issue or pull request on `kehto/web`, `napplet/naps` or `nostr-protocol/nips`, as appropriate. The first four kehto gaps kernl found, filed as kehto/web #397–#400, are released and in use ([D-020](../decisions.md#d-020)); what is still open is in [Alpha status](../alpha-status.md#upstream-gaps).
3. **Implement it locally with a recorded gap.** Only when 1 is impossible and 2 is pending. The local implementation sits behind an interface, cites the upstream issue, and is removed when upstream lands.

kernl never re-implements a kehto primitive because it was easier than reading kehto's source, and never invents wire format. When a NAP is ambiguous, kernl prefers an upstream issue over a guess and records the ambiguity next to the code.

## What conformance is checked by

- **Gherkin scenarios** in `packages/*/features/` for every protocol-visible behaviour, named after the clause they implement where one exists.
- **Review.** A change that touches an envelope shape, a domain's semantics or the handshake cites the clause in its description. A reviewer checks the clause, not the summary.

`@napplet/conformance` (envelope validators per NAP domain, manifest validation and the reference mock shell's expectations of a host) is not part of the test suite yet; running it against the shell's bridge is on the [Roadmap](../roadmap.md#_7-conformance).

The docs are non-normative. Where a page here and the specification disagree, the specification wins and the page has a bug.

## Recording a gap

A gap is anything kernl does that the specification does not say, or does not do that the specification says. Record it in three places:

1. **Next to the code**, as a comment that names the clause and the upstream issue. This is one of the few comments the slop gate accepts, because a reader could not infer it.
2. **In `DECISIONS.md`**, as a `D-NNN` entry with Context, Decision, Consequences and Reversal cost. If the gap is a kehto seam, the entry says what upstream change would close it.
3. **In [Alpha status](../alpha-status.md)**, under upstream gaps, so a reader deciding whether to depend on kernl sees it without reading the decisions log.

A gap closes when upstream lands and the local layer is deleted. The `DECISIONS.md` entry stays, with a `Superseded by` line.

## Tie-breaking

Protocol conformance is second in `SOUL.md`'s tie-breakers, below the user's safety and agency and above the applet developer's ability to build. A conformance requirement that would weaken the user's position is not implemented silently; it is raised upstream with the conflict stated, and `DECISIONS.md` records which way kernl went while the question is open.
