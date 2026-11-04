# SOUL.md

What kernl is, what it refuses to be, and the order in which it breaks ties. Read this before `AGENTS.md`. When a decision is not covered here or in `DECISIONS.md`, decide in the spirit of this document and then record the decision.

## One sentence

kernl is an opinionated shell for sandboxed web applets, built on the unopinionated [kehto](https://github.com/kehto/web) toolkit, that treats the person at the keyboard as the only principal who matters.

## The relationship to kehto

kehto is a set of packages that let anyone build a NIP-5D shell with their own opinions on top. kehto does not pick a relay library, a signer, a consent model, a layout engine or a deployment story. kernl picks all of them. Every opinion below is a choice kehto deliberately left open.

kernl does not fork kehto. When kernl needs behaviour kehto does not have, kernl either composes it from kehto's primitives, or proposes it upstream, or implements it locally with a note in `DECISIONS.md` that names the upstream gap. kernl never re-implements a kehto primitive because it was easier than reading kehto's source.

## The five opinions

### 1. Applesauce is the event layer

Every relay connection, every event store, every signer, every account, every loader and every event factory in kernl goes through [applesauce](https://applesauce.build). It is the fastest, best supported and most complete reactive event SDK in the JavaScript ecosystem, and kernl does not hedge that bet with a second library doing the same job.

Concretely:

- One `EventStore` per shell. Applets never get a reference to it; services read from it on their behalf.
- One `RelayPool`. All kehto relay surfaces are adapters over that pool.
- One `AccountManager`. Signers are applesauce signers. kernl never keeps or persists raw key bytes outside an applesauce signer class; the one place the shell generates a new key hands it straight to a password-encrypted signer.
- `nostr-tools` appears only where applesauce or kehto require it as a peer, never as a direct import in kernl source.

### 2. The shell exists to empower the user and to contain the applet

A NIP-5D shell has two jobs. It gives the user a place where their identity, relays, contacts, media and messages are theirs and portable. And it gives an untrusted program a place to run where the worst it can do is bounded. The shell cannot protect the user from everything. It can do a great deal, and kernl does all of it that it can.

Concretely:

- Applets run in an opaque-origin `srcdoc` iframe with `sandbox="allow-scripts"` and a zero-network Content Security Policy. Everything reaches the network through a shell service the user can see, rate-limit and revoke.
- Applets never hold keys, are never given `window.nostr` by the shell, and never see plaintext the user did not ask to show them. Browser extensions that inject into every frame are outside the shell's control, and the docs say so.
- Every write the shell signs on an applet's behalf that replaces or erases part of the user's public record is shown to the user as what it changes, not as JSON, and waits for their answer.
- Identity is bound to a verified artifact hash and a live message port. When either changes, the shell closes the applet; grants stay with that exact artifact, and changed bytes start with none.

### 3. When kehto offers a mitigation, kernl turns it on

If kehto ships an experimental privacy or security mitigation, kernl enables it by default and documents how to loosen it. The user is a more important persona than the applet developer. This is interpreted within reason: an applet interface so constrained that applets cannot be written protects nobody, because there would be nothing to run.

Concretely:

- The behavioural firewall ships enabled, in its strict profile. Focus-aware tightening is enforced: an applet you are not using that goes over its smaller budget is turned away before its request is handled (D-012, D-020).
- Hidden and minimised applets cannot act: their requests are held until you can see them, though you can still close them, and one that keeps downloading past its allowance is closed (D-020).
- Replay and cross-window identity checks are on.
- Artifact bytes are cached only after hash verification, and re-verified on every read.
- In the hosted shell, only the user loosens a mitigation, never a developer flag. Today that is one shell-wide profile; per-applet loosening is planned (D-003, roadmap). An embedding host may choose the starting profile, which changes limits only; the sandbox, the frame lock and consent are fixed.

The test for "within reason" is: does a competent developer, reading our docs, still have a clear path to build the applet they wanted? If yes, the mitigation stays on.

### 4. One identity layer, many protocols, no protocol branding

Nostr is kernl's identity and resolution layer. It is how the user is known, how applets are found and verified, and how peers are reached. It is not the only protocol kernl speaks. kernl bridges as many protocols as it reasonably can to that identity layer: BitTorrent, NZB, Soulseek, email and whatever comes next.

Concretely:

- A bridge is a shell-owned service that resolves a protocol-specific locator to bytes or a conversation, behind the same grant and quota model as everything else. (Per-request consent for bridges is planned; see the roadmap.)
- Bridges are named by what they do for the user ("downloads", "mail"), not by the protocol they speak.
- Public-facing surfaces, the website above all, do not name protocols. The protocol is the plumbing. The person is the point.

### 5. No encrypted messaging protocol is inherently superior

kernl attempts to support any reasonable private messaging protocol and expose each one through the same Direct Messenger interfaces. Users pick the protocol their correspondent can read, and the shell makes that choice visible and reversible.

Concretely:

- A messaging provider is a pluggable module with one contract: discover conversations, read, send, subscribe, and describe its own security properties truthfully.
- The shell does not rank providers. It describes them: forward secrecy or not, metadata exposure, whether the correspondent needs the same client.
- The NAP `dm` domain is a projection over every enabled provider.

## Requirements that are not negotiable

- **Docs are a product.** Every public export has a reference page, every concept has an explanation, every task has a how-to. A feature without docs is not shipped.
- **Behaviour is specified before it is implemented.** Features are written in Gherkin, step definitions make them executable, and coverage is complete. A scenario that cannot be written is a design that is not finished.
- **No slop.** The quality gate scores 100. Code reads like one careful person wrote it: no decorative comments, no defensive clutter, no abstractions that exist for their own sake.
- **The README is beautiful and useful in equal measure.** It is the first thing a person sees and it should make them want to stay.
- **The website does not say the protocol's name.** Protocols are invisible. The site is about what a person can do.

## Tie-breakers, in order

1. The user's safety and agency.
2. Protocol conformance with the canonical upstream specification.
3. The applet developer's ability to build.
4. Documentation accuracy.
5. Performance.
6. Code size.

If two of these conflict, the lower-numbered one wins, and the conflict is recorded in `DECISIONS.md`.

## Words we use

| Say | Not | Why |
|---|---|---|
| applet | napplet, app, dapp | In public surfaces. "napplet" remains the protocol term in code and specs. |
| shell | OS, desktop, browser | kernl is a shell. It runs in a browser; it is not one. |
| grant | permission, capability (in UI) | A grant is something the user gave and can take back. |
| provider | protocol (in UI) | Users choose providers by what they do, not by their wire format. |
| guard | firewall, mitigation (in UI) | The guard is the set of protections between an applet and the user. |

## Words we avoid

Marketing adjectives ("blazing", "seamless", "revolutionary"), filler ("in order to", "it is worth noting"), hedges that hide a decision ("may or may not"), and any protocol name on the public website.
