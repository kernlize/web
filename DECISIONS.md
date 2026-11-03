# DECISIONS.md

Architecture decisions for kernl, newest last. Each entry records what was decided, why, and what it would take to reverse it. A decision stays here after it is reversed; it gets a `Superseded by` line instead of being deleted.

Format: `D-NNN · title` → Context, Decision, Consequences, Reversal cost.

---

## D-001 · kernl composes kehto; it does not fork it

**Context.** kehto publishes `@kehto/{acl,firewall,runtime,shell,services,nip,wm}` as the unopinionated NIP-5D toolkit. kernl is the opinionated shell. Two of kehto's seams are narrower than kernl wants: `ShellAdapter` does not forward `getFocusContext`, `onFirewallEvent` or `firewallPersistence` to the runtime, and `createRuntime` hardcodes the ACL default policy to `'permissive'`. The transport internals (`createNip5dTransport`, `createShellReadyState`) are not exported, so kernl cannot assemble its own bridge from kehto parts.

**Decision.** kernl depends on the published `@kehto/*` packages at pinned minor ranges and uses `createShellBridge` unchanged. Behaviour kehto does not expose is built in front of the bridge, not inside a fork:

- Focus-aware rate limiting runs in `@kernl/guard` using the pure `@kehto/firewall` `evaluate()` engine with focus supplied by kernl's window manager. The runtime's built-in firewall is additionally tightened through `bridge.runtime.firewallState`.
- A restrictive grant posture is produced with `capabilities.resolveEnvironment`, which narrows the advertised domains per applet identity until the user grants them, plus explicit `aclState.grant` calls. The runtime's permissive default is never reached for a domain the user has not granted.

**Consequences.** Four upstream gaps are recorded against kehto/web rather than patched locally: (1) forward the firewall hooks through `ShellAdapter`; (2) let the host choose the ACL default policy; (3) offer a hook that can hold or drop port traffic, since `onNappletMessage` runs before dispatch but its answer is ignored; (4) let the runtime firewall apply an unfocused multiplier, which needs (1)'s `getFocusContext` and a setter for `unfocusedMultiplier`; until then the runtime treats every window as focused. When any of them lands, the corresponding kernl layer shrinks (see D-012).

**Reversal cost.** Low. Both local layers sit behind interfaces in `@kernl/guard` and `@kernl/core` and can be deleted when upstream provides the hook.

## D-002 · applesauce v7 is the only event layer

**Context.** kehto's reference runtime (Paja) uses `nostr-tools` `SimplePool`. kernl's first opinion is that applesauce is the event layer.

**Decision.** `applesauce-core` (`EventStore`), `applesauce-relay` (`RelayPool`), `applesauce-signers`, `applesauce-accounts` (`AccountManager`) and `applesauce-loaders` are the only libraries kernl source imports for events, relays, signing and accounts. `nostr-tools` is a peer dependency of `@kernl/core`, because kehto and applesauce require it; kernl source does not import it. kehto's `RelayPoolLike`, `RelayPoolServiceOptions` and `DmRelayPool` contracts are satisfied by thin adapters over one shared `RelayPool` in `@kernl/core/applesauce`.

**Consequences.** One pool, one store, one account manager per shell. A guard test fails the build if `nostr-tools` is imported from kernl source.

**Reversal cost.** High by design. The adapters are small, but the opinion is the point.

## D-003 · Every kehto mitigation ships on, in its strict profile

**Context.** Opinion three in `SOUL.md`.

**Decision.** `@kernl/guard` exposes three profiles, `strict`, `balanced` and `relaxed`. The hosted shell boots in `strict`. The target is that the user loosens the profile per applet; in this draft the user changes one shell-wide profile from the guard panel (see Status below), never a developer flag in the hosted shell. An embedding host may choose the starting profile (`KernlOptions.guard.profile`), which changes limits only; the sandbox, the CSP, the frame lock and consent are fixed. The mitigations and their defaults are listed in `docs/concepts/guard.md` and surfaced in the UI as a readable list with reasons.

**Consequences.** Some applets will hit limits in `strict`. The guard emits an event for every rejection and deferral so the user can see what happened and decide.

**Status in the first draft.** The profile is shell-wide and not persisted: `GuardFacade.setProfile` rebuilds the single pipeline, and windows already open keep the runtime rates installed at mount. Per-applet, remembered loosening is the target this decision describes and is tracked in `docs/roadmap.md`. The default remains `strict` on every boot, so the gap errs toward the user. kehto's experimental mitigation `experimental.nestedContextLock` is on kehto main (4d8a5693) but in no `@kehto/shell` release; kernl applies an attributed port of it to every applet until a release carries the flag (D-014).

**Reversal cost.** A one-line profile change for a user; a `SOUL.md` amendment for the project.

## D-004 · Four packages, one app, one docs site

**Context.** The repository needs a shape that lets docs, tests and publishing stay per-package without forcing the shell UI into a framework-free constraint.

**Decision.**

| Workspace | Name | Role | Framework |
|---|---|---|---|
| `packages/guard` | `@kernl/guard` | Ingress flood control, visibility gate, focus-aware firewall, CSP profile, nested-frame lock, mitigation descriptions. Pure. | none |
| `packages/messaging` | `@kernl/messaging` | Messaging provider contract, registry, composite NAP-DM adapter, provider descriptions. Pure. | none |
| `packages/bridges` | `@kernl/bridges` | Locator parsing, bridge contract, registry, resource resolver with SSRF policy. Pure. | none |
| `packages/core` | `@kernl/core` | Composition root: applesauce adapters, applet resolution and mount plan, consent summaries, layouts, persistence. Browser-agnostic. | none |
| `apps/web` | `@kernl/web` | Landing site at `/` and the shell at `/app/`. | Astro 7, Svelte 5 islands |
| `docs` | `@kernl/docs` | Documentation at `/docs/`. | VitePress |

Published packages have zero framework dependencies, matching kehto's rule. The app is free to use Svelte.

**Consequences.** TypeDoc runs over the four packages. Each has a `docs/packages/<name>.md` page with a version row, enforced by `scripts/audit-docs.mjs`.

**Reversal cost.** Medium. Merging packages is cheap; splitting the app later is not.

## D-005 · Behaviour is specified in Gherkin and executed by vitest

**Context.** The requirement is BDD with full coverage. kehto and napplet both use plain vitest.

**Decision.** Every package has a `features/` directory of `.feature` files run by [quickpickle](https://github.com/dnotes/quickpickle) inside vitest, with step definitions in `features/steps/`. Coverage thresholds are 100% for statements, branches, functions and lines over `packages/*/src`. Plain `*.test.ts` files are allowed only for property-style checks that do not read as behaviour; they do not substitute for a feature.

**Consequences.** A behaviour without a scenario is not merged. Coverage is enforced in CI through `vitest run --coverage`.

**Reversal cost.** Low mechanically, high culturally.

## D-006 · The public site never names a protocol

**Context.** Requirement five: the website is gorgeous and does not say the protocol's name.

**Decision.** `apps/web` output is scanned by `scripts/check-public-vocabulary.mjs` for a denylist (`nostr`, `nip-`, `napplet`, `relay`, `pubkey`, `npub`, `nsec`) and the build fails on a hit. The denylist applies to the landing pages and the shell UI copy. It does not apply to `docs/`, which is written for developers and must name things precisely.

**Consequences.** UI copy says "applet", "account", "network", "provider", "guard". Developer-facing terms live in the docs.

**Reversal cost.** Low.

## D-007 · The site is agent-readable by construction

**Context.** Requirement: an agent-readiness score of 84 or higher, `llms.txt`, WebMCP where sensible.

**Decision.** The Astro build emits `/llms.txt`, `/llms-full.txt`, a Markdown twin for every page with `<link rel="alternate" type="text/markdown">`, `/robots.txt` that allows the common AI crawlers and references the sitemap, JSON-LD (`WebApplication`, `SoftwareSourceCode`), Open Graph and canonical metadata, and semantic forms with WebMCP declarative attributes plus a guarded `navigator.modelContext.registerTool` registration. The docs build emits `/docs/llms.txt` and `/docs/llms-full.txt`. `scripts/audit-agent-readiness.mjs` checks the built artifact for every item.

**Consequences.** Agent discovery is part of the build contract, not a later task.

**Reversal cost.** Low.

## D-008 · Repository and deployment

**Context.** The GitHub organisation is `kernlize`; the repository is `kernlize/web`. No custom domain is decided.

**Decision.** URLs in package metadata point at `https://github.com/kernlize/web`. The Pages artifact is built with a configurable `SITE_BASE` (default `/`) and `SITE_URL`; the Pages workflow reads both from repository variables and falls back to `/web/` and `https://kernlize.github.io/web/`. When a domain is chosen, only the variables change. See D-013 for why production should be a domain root.

**Consequences.** Absolute URLs in `llms.txt`, sitemap, canonical tags and JSON-LD are derived from `SITE_URL` at build time.

**Reversal cost.** Low.

## D-009 · Messaging providers describe themselves; the shell does not rank them

**Context.** Opinion five.

**Decision.** `MessagingProvider.properties` is a fixed, truthful set of fields (forward secrecy, post-compromise security, metadata protection, same-client requirement, group support, specification reference). The shell renders these fields verbatim in the provider picker. There is no "recommended" flag. The first draft ships three providers: `private` (gift-wrapped private messages), `legacy` (the original direct-message format, marked as metadata-exposing), and `ratchet` (double-ratchet sessions, marked experimental and available only when its runtime is supplied).

**Consequences.** Adding a provider is a package change plus a docs page. Removing the ranking is not possible because there is none.

**Reversal cost.** Low.

## D-010 · Bridges are named by what they do

**Context.** Opinion four.

**Decision.** `@kernl/bridges` defines a `Bridge` with a user-facing `label` (`downloads`, `mail`) and a list of locator schemes (`magnet:`, `nzb:`, `slsk:`, `mailto:`). The first draft ships a complete HTTP bridge with SSRF policy and four parsers with backend interfaces (`TorrentBackend`, `NzbBackend`, `SoulseekBackend`, `MailBackend`). Without a backend, a bridge reports `unavailable` and the shell shows that honestly. Backends are out of scope for this draft and are tracked in `docs/roadmap.md`.

**Consequences.** The bridge contract is exercised end to end by the HTTP bridge, so later backends plug into a tested path.

**Reversal cost.** Low.

## D-011 · Preview mode is a product feature, not a test double

**Context.** The shell needs to be usable without an account, a network or a published applet: for people evaluating it, for the Playwright suite, and for the landing page's "open" form when nothing real is reachable.

**Decision.** `apps/web/src/shell/preview-kernl.ts` implements the same `Kernl` contract as `@kernl/core` using the real `@kernl/guard`, `@kernl/messaging` (memory backend with a scripted correspondent) and `@kernl/bridges` packages, a real applesauce `AccountManager`, and two sample applets whose `srcdoc` carries the guard's CSP and exercises consent, notifications, flooding and link opening. `?preview=1` selects it; the live path falls back to it only when `createKernl` is unavailable, and says so in a notice.

**Consequences.** Preview behaviour is held to the same vocabulary and accessibility rules as the live shell, and to the same rules where it stands in for it: it asks before a write only for the kinds `@kernl/core`'s `isDestructiveKind` accepts and describes them with `describeChange`, its guard observes without holding anything back and stops an applet only by quarantine (D-012), it starts `strict` on every load, and its sample applets remove WebRTC the way kehto's prelude does. Sample applets are the first place a new mitigation is demonstrated.

**Reversal cost.** Low; the preview is one module behind the contract.

## D-012 · Guard enforcement is layered: the runtime firewall refuses, kernl observes and reports, quarantine stops the triggering message

**Context.** kehto's bridge owns the `MessagePort` an applet speaks over, and exposes applet traffic to the host only through `ShellAdapter.onNappletMessage`. kehto's `dispatchEnvelope` calls that hook synchronously for each envelope, before it resolves the window's session and dispatches the envelope to the runtime, and ignores the hook's answer. The runtime then evaluates its own firewall, in the same synchronous call, before handing the envelope to a service. kernl cannot sit between the port and the runtime (D-001).

**Decision.** Enforcement is split by what each layer can do:

- **Refused before dispatch by kehto's runtime firewall: rates and the startup burst.** When an applet is mounted, kernl installs the guard profile's per-class rates and global rate in the runtime firewall (`applyRuntimeFirewallRules`, translating op classes through `RUNTIME_OP_CLASSES`), with exceed action `block`. It sets no policy, because kehto's `allow` policy makes `evaluate()` skip every rate, matcher and burst check. The runtime supplies `initElapsedMs`, so kehto's own startup burst guard also applies at kehto's default: more than 20 operations in a window's first 3 s are blocked. A refused envelope is answered with an error starting `firewall:`.
- **Refused before dispatch: size caps.** kehto's matchers cannot see the size of a download or query request, because the runtime measures only `envelope.event`. kernl's ingress guard measures every envelope inside `onNappletMessage`; for one over its cap it emits `size:<class>`, and `createKernl` calls `refuseCurrentDispatch`, which sets the applet's runtime policy to `deny` for that one synchronous dispatch and restores the previous policy in a microtask, before the next port message can arrive. The applet receives a firewall error, nothing is fetched, and the user sees the guard event.
- **Reported, not refused: focus tightening, bursts above kernl's per-second rate, and a hidden window's activity.** kernl's ingress guard, visibility gate and focus firewall observe every envelope inside `onNappletMessage` with the shell's focus and visibility, but cannot hold or drop it. Their findings are guard events and the envelope is still dispatched.
- **Quarantined: floods and hidden downloads past the allowance.** A `quarantine` disposition revokes the applet's binding inside that same callback, so kehto finds no session for the window, the message that crossed the limit is not dispatched, and the applet is closed.

The window-level `hello` is the one message kernl can hold or drop before kehto sees it.

**Consequences.** Deferral while hidden is advisory in this draft: the gate cannot hold a port envelope, so its effect is the tightened, reported budget, the hidden-download allowance that quarantines, and the event trail, not a held queue. The runtime firewall applies no unfocused multiplier, because kehto does not forward focus to it (D-001, gaps 1 and 4); the profile's multiplier is applied only by kernl's focus firewall, which reports. The runtime's refusals reach the applet but not the host, because `ShellAdapter` does not forward `onFirewallEvent`; the guard panel shows kernl's own count of the same rates. Rates are installed at mount, so a window keeps the rates it was mounted with when the profile changes. Earlier drafts of this entry said the rates were refused while kernl also set the `allow` policy that bypassed them; `docs/alpha-status.md` records the correction. The upstream requests that would turn the observing layer into a true pre-dispatch hook are recorded with D-001's gaps.

**Reversal cost.** Low; the pipeline sits behind `createGuardPipeline` and shrinks when kehto exposes a hook that can hold or drop an envelope. `refuseCurrentDispatch` goes when kehto's runtime can measure the envelopes it cannot see today.

## D-013 · The site is served at a domain root

**Context.** D-007 sets an agent-readiness score of 84 or higher. Measured with amiagentready on 2026-11-03, the scanner works on the **origin**: it scores the domain's homepage whatever path it is given, and reads `robots.txt` and `llms.txt` from the domain root. The scoring is reproducible from its response: each scored check contributes its weight, pass at full, warn at half, fail at zero.

**Measurement.** The Pages artifact served at the root of a temporary public origin, through `scripts/serve-pages.mjs`, scored **92** (12 pass, 2 warn, 0 fail; WebMCP detected). The two warns are "online booking" (kernl has none) and "schema coverage" (asks for local-business types such as opening hours and ratings, which do not apply). The same origin hosts `/docs/`, so the one score covers the website and the docs.

**Decision.** Production serves the Pages artifact at the root of its own domain, and the host answers `Accept: text/markdown` with the page's Markdown twin (`Vary: Accept`), as `scripts/serve-pages.mjs` does. The Pages workflow reads `SITE_URL` and `SITE_BASE` from repository variables, so a custom domain needs no code change.

**Consequences.** Served from the project subpath `kernlize.github.io/web/` (D-008's default), the score drops to about 82 because the origin has no `robots.txt` or `llms.txt`. A static host without content negotiation scores 90 at a root. Both regressions are visible in `docs/how-tos/deploy.md`.

**Production, 2026-11-03.** The artifact is published to the public `kernlize/kernlize.github.io` repository (built output only; this repository stays private) and served at https://kernlize.github.io/. Live amiagentready score: **90**, no failing checks; the site and `/docs/` share the score because the tool grades the origin. The browser suite, including the public-vocabulary walk-through, passes against the live URL (`PLAYWRIGHT_BASE_URL=https://kernlize.github.io`).

**Publishing is manual, by the maintainer's choice (2026-11-03).** `pnpm site:publish` builds, runs the vocabulary and agent-readiness gates, and pushes `.pages/` to the site repository. CI builds and audits on every push; it would publish only if a scoped `SITE_PUBLISH_TOKEN` were added, and none is.

**Reversal cost.** Low; only deployment configuration.

## D-014 · Applets cannot open nested frames: kehto's nested-context lock, ported until it ships

**Context.** An independent review showed that applet code could create a child `<iframe srcdoc>` whose fresh realm still had a working `RTCPeerConnection`, and that peer connection gathered a server-reflexive candidate from a public STUN server. The published `@kehto/shell` 0.29.0 removes the peer-connection globals from the applet's own realm only. CSP cannot help: `about:srcdoc` and `about:blank` children involve no fetch, so `frame-src 'none'` and `child-src 'none'` never apply, and no shipped directive governs WebRTC. The probe in `tests/e2e/applet-network-sealed.spec.ts`, run against a srcdoc built by kehto 0.29.0 alone, reproduces it in Chromium: every scripted route it tries (`createElement`, `createElementNS`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `createContextualFragment`, `DOMParser` with `importNode` and `adoptNode`, `createDocument`, `createHTMLDocument`) produced a child realm that reported `host` and `srflx` candidates, and `document.write` created frames as well. kehto main (4d8a5693) closes this behind `experimental.nestedContextLock`, which no release carries yet.

**Decision.** `@kernl/guard` carries an attributed, temporary port of that lock, and the mount plan always applies it (D-003):

- `assertAppletHasNoFrame` scans the verified bytes before they become a srcdoc and refuses static `iframe`, `frame`, `frameset`, `object`, `embed`, `portal` and `fencedframe` markup with `denied:nested-frame`. It parses with the host's `DOMParser` when there is one and falls back to a lexical match, which may over-reject.
- `renderFrameLockScript` installs a Trusted Types `default` policy that refuses frame markup at every HTML string sink, and pins `Document.prototype.createElement`, `createElementNS` and `DOMImplementation.prototype.createDocument` non-configurable to refuse frame tag names. `planMount` inserts it immediately after kehto's namespace prelude, so it runs before any applet script.
- `createAppletCsp` carries `TRUSTED_TYPES_DIRECTIVES` (`require-trusted-types-for 'script'; trusted-types default`). kehto 0.29.0 throws on directives outside its baseline, so `planMount` appends them to the CSP meta kehto rendered, and refuses with `unavailable:frame-lock` if kehto's head is not where it expects.

With the lock, the same probe sees every route throw `TypeError: denied:nested-frame`, no child realm, and no candidate in any realm, while the host page's control reaches the STUN server.

**Consequences.** An applet that creates child frames, ships one in its markup, or registers its own Trusted Types policy is refused or breaks. That is the trade opinion 3 in `SOUL.md` makes: the user outranks the applet developer, and an applet has no legitimate need for a nested browsing context inside a shell that already gives it a window. A string written to an HTML sink that merely mentions a frame tag is refused too.

**Reversal.** Delete `packages/guard/src/frame-lock.ts`, the Trusted Types field of `AppletCsp` and the splice in `planMount`, and pass `experimental: { nestedContextLock: true }` to `prepareNappletSrcdoc` once `@kehto/shell` ships it. The e2e probe stays as the regression test.

**Update to D-014, 2026-11-03.** A further independent review found four creation routes past the factory pins, each producing a child frame with a working peer connection that reached a public STUN server: a customized built-in element constructed with `new` (constructors skip `createElement`), XSLT `transformToFragment`, and an XHTML-parsed element with a namespace prefix moved in with `importNode` or `adoptNode` (the string-sink pattern did not match prefixed tags). Creation routes are open-ended, so the lock now also guards **insertion**: a frame gets a realm only when connected, and connecting goes through a small set of methods. `appletInsertionLock` pins `appendChild`, `insertBefore`, `replaceChild`, `append`, `prepend`, `replaceChildren`, `before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `Range.insertNode` and `Range.surroundContents` on their owning prototypes to refuse any node that is, or contains (descendants, template content, shadow roots), an HTML-namespace frame element. Node identity is read through native getters captured before applet code runs, so an element cannot disguise itself. It also refuses custom elements that extend frame elements, removes `XSLTProcessor`, and the string-sink pattern now matches prefixed tags. `tests/e2e/applet-network-sealed.spec.ts` covers the four routes and thirteen insertion routes. kehto's lock at 4d8a5693 shares the creation-only design and is affected by the same routes; this is to be reported upstream with them. Cost: every DOM insertion in an applet walks the inserted subtree once.

## D-015 · Messaging backends are built on the account signer

**Context.** The first draft shipped every messaging provider unavailable. kehto's sealed-message adapter wants the owner's raw secret key, and kernl keeps keys only inside applesauce signer instances (`SOUL.md` opinion 1, `AGENTS.md` security posture). Browser extensions and remote signers never hand a key over at all, so an adapter that needs one would exclude most accounts and would make kernl the place a key leaks from.

**Decision.** `@kernl/core` builds its own backends from applesauce helpers and the active account's signer:

- `createPrivateMessagesBackend({ store, pool, tiers, signer, selfPubkey, now? })` sends NIP-17 messages: the kind 14 rumour is sealed in a kind 13 event that the account signer signs, encrypting with its `nip44`, and the seal is wrapped in a kind 1059 event signed by an ephemeral key. The ephemeral key is generated inside an applesauce `PrivateKeySigner`, used for that one wrap, and dropped with the signer; it is never persisted and never leaves the class.
- `createLegacyMessagesBackend(...)` sends NIP-04 kind 4 messages through `signer.nip04`, normalised the same way, and stays marked metadata-exposing (D-009).
- Delivery goes to the recipient's kind 10050 inbox relays. A recipient who publishes none is reached through the sender's `outbox` and `super` tiers, because a message that is never sent protects nobody and those are the relays the user already chose. A copy is wrapped to the sender. The subscription reads kind 1059 addressed to the user from the user's own inbox relays, or the same tiers when there are none. A conversation id is the sorted participant set.
- `createKernl` wires both unless `KernlOptions.messagingBackends` overrides them. Availability follows the active account: `private` needs a signer with `nip44`, `legacy` one with `nip04`. The reasons are `sign-in-required` with no active account and `signer-cannot-encrypt` when the signer lacks the method; `ratchet` keeps `no-runtime`. `needs-local-key-signer` is gone.
- The shell's own Messages panel decrypts the user's messages without a consent prompt. The request comes from the shell, on the user's behalf, to show the user their own messages; a prompt there would ask the user whether they may read their mail. An applet reaches messages only through the NAP `dm` domain, which is a grant the user gives and can revoke, and through the guard's `dm:send` rate.

**Consequences.** Messaging works with every account type that can encrypt, including ones whose key kernl never sees. A remote signer or extension may ask its own question per decryption; kernl does not suppress it. A read-only account sees both providers unavailable with `signer-cannot-encrypt`. The inbox fallback means a recipient without inbox relays may never see a message sent to relays they do not read; the sender sees it delivered to those relays, not read. kehto's sealed-message adapter is not used; when it can take a signer instead of a key, the backend can be swapped behind `MessagingBackend` without a contract change (D-001).

**Reversal cost.** Low; both backends sit behind `MessagingBackend` and `KernlOptions.messagingBackends`.
