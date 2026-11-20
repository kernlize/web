# Public vocabulary

The public website and the shell UI never name a protocol. The person is the point; the protocol is plumbing. This page is the denylist, the reasoning, and where the rule stops. One word differs between the two: the website never says "relay", and the shell does ([D-051](../decisions.md#d-051)).

## The rule

`scripts/check-public-vocabulary.mjs` scans the built output of `apps/web` (the landing pages and the shell's UI copy) and fails the build on any of these, case-insensitively, as whole words or prefixes where marked:

| Denied | Say instead |
| --- | --- |
| `nostr` | "your account", "the network" |
| `nip-` (prefix) | describe the behaviour: "signing extension", "remote signer", "private messages" |
| `napplet` | "applet" |
| `relay` (website only) | "network", or nothing. The shell says "relay": it is the accurate word for the thing a person adds and removes there ([D-051](../decisions.md#d-051)) |
| `pubkey` | "account", "address" |
| `npub` | "address" |
| `nsec` | "secret key", in the one place the shell must warn about it |

Two checks enforce it:

- **Build time.** `scripts/check-public-vocabulary.mjs` reads every HTML, Markdown, text, JSON and XML file in the Pages artifact outside `docs/`, so Astro pages, JSON-LD, `llms.txt` and the Markdown twins are covered. Its list includes `relay`.
- **In a browser.** `tests/e2e/public-vocabulary.spec.ts` loads every public page and walks the shell (sign-in, launcher, applet summary, a running applet's frame, the consent dialog with its record view open, the guard, grants and downloads sheets, and every section of the Settings window). It reads what a person can perceive: rendered text, `title`, `aria-label`, `placeholder` and `alt`. Copy rendered by scripts, which the file scan cannot see, is covered here. Its list is `DENIED_WORDS` in `apps/web/src/shell/vocabulary.ts`, which has no `relay`.

Identifiers inside JavaScript bundles are not copy and are not checked. The consent dialog's record view shows every field of the event it will sign, with plain labels ("Signed by", "Type", "Labels") instead of wire field names.

## Why

Three reasons, in the order `SOUL.md` ranks them.

**The user's agency.** A person deciding whether to run an applet needs to know what it will do and what it can reach. A protocol name tells them nothing about either; it tells them which club they are supposed to already belong to. "This applet wants to publish on your behalf" is a decision a person can make. "This applet requires `relay` and `outbox`" is not.

**Protocol conformance is a property of the code, not the copy.** kernl conforms to NIP-5D and the NAPs, and the docs say so precisely. Saying so on the landing page would not make the code conform more; it would make the page about the specification instead of about what a person can do.

**Providers and bridges are chosen by what they do.** A user chooses a messaging provider by whether their correspondent can read it and what an observer learns, not by its wire format. A bridge is "downloads", not the name of a peer-to-peer protocol. Naming protocols in the UI would invite ranking by familiarity, which [D-009](../decisions.md#d-009) and [D-010](../decisions.md#d-010) rule out.

## Where the rule stops

- **These docs.** Written for developers, who need the names. Every page here uses them.
- **Code, specs, commit messages, issues.** `napplet` is the protocol term and stays in identifiers and in `features/`.
- **`specification` fields.** `SecurityProperties.specification` and a bridge's protocol are shown in the docs, never in the picker.
- **Addresses.** A relay or file server is shown by its own host, exactly as it is, with no nickname in its place, and a host belongs to whoever runs it: `relay.nostr.band` is shown as that. The build-time scan blanks `http(s)://` URLs. The browser check blanks addresses before it reads the words (`withoutAddresses` in `vocabulary.ts`): lower-case labels joined by dots and ending in a top-level label, with a scheme, port and path when present. A token whose last label is itself a denied word is not treated as an address, and neither is one with a capital, so two words run together by a full stop cannot hide one.
- **The secret-key warning.** The one place the shell mentions `nsec` is the warning that it will never ask for one.

## The words we use

| Say | Not | Why |
| --- | --- | --- |
| applet | napplet, app, dapp | "napplet" remains the protocol term in code and specs. |
| shell | OS, desktop, browser | kernl runs in a browser; it is not one. |
| grant | permission, capability | A grant is something the user gave and can take back. |
| provider | protocol | Users choose providers by what they do. |
| guard | mitigation | The guard is the set of protections between an applet and the user. The firewall is one of them: the rules for what goes ahead without asking. |
| relay (in the shell) | server, "servers that introduce you", a role nickname | A relay is a relay, and it is shown by its own host. File servers and connection helpers are different things and keep their names. |

Marketing adjectives, filler and hedges that hide a decision are out everywhere, including here.
