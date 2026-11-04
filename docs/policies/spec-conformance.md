# Spec conformance

kernl conforms to specifications it does not own. This page says which ones, what "upstream first" means in practice, and how a gap is recorded.

## Authority

| Area | Authority | Local copy |
| --- | --- | --- |
| Shell–applet protocol | NIP-5D, [nostr-protocol/nips PR #2303](https://github.com/nostr-protocol/nips/pull/2303) | none |
| NAP domains (`relay`, `outbox`, `dm`, `resource`, …) | [napplet/naps](https://github.com/napplet/naps) | none |
| Wire types and dispatch | [`@napplet/core`](https://www.npmjs.com/package/@napplet/core), pinned `>=0.37.0 <0.38.0` | the installed package |
| Shell composition | kehto source, `@kehto/*` at the pinned ranges | the installed packages |
| Event layer | applesauce v7, [applesauce.build](https://applesauce.build) | the installed packages |
| Messaging protocols | NIP-17, NIP-04, the nostr double-ratchet draft, as named in each provider's `specification` | none |

kernl keeps no local copy of a specification text. A copy drifts; a link does not. When the PR or a NAP document changes, the behaviour changes in kernl in a pull request that cites the clause.

## Upstream first

When kernl needs something a specification or an upstream package does not provide, the order is:

1. **Compose it from what exists.** Most of kernl is this: the guard composes `@kehto/firewall`'s `evaluate()` and kehto's `filterNappletMessage`, the restrictive posture composes `aclDefaultPolicy`, `resolveEnvironment` and `aclState.grant`.
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
