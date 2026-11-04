# DECISIONS.md

Architecture decisions for kernl, newest last. Each entry records what was decided, why, and what it would take to reverse it. A decision stays here after it is reversed; it gets a `Superseded by` line instead of being deleted.

Format: `D-NNN · title` → Context, Decision, Consequences, Reversal cost.

---

## D-001 · kernl composes kehto; it does not fork it

**Context.** kehto publishes `@kehto/{acl,firewall,runtime,shell,services,nip,wm}` as the unopinionated NIP-5D toolkit. kernl is the opinionated shell. Two of kehto's seams are narrower than kernl wants: `ShellAdapter` does not forward `getFocusContext`, `onFirewallEvent` or `firewallPersistence` to the runtime, and `createRuntime` hardcodes the ACL default policy to `'permissive'`. The transport internals (`createNip5dTransport`, `createShellReadyState`) are not exported, so kernl cannot assemble its own bridge from kehto parts.

**Decision.** kernl depends on the published `@kehto/*` packages at pinned minor ranges and uses `createShellBridge` unchanged. Behaviour kehto does not expose is built in front of the bridge, not inside a fork:

- Focus-aware rate limiting runs in `@kernl/guard` using the pure `@kehto/firewall` `evaluate()` engine with focus supplied by kernl's window manager. The runtime's built-in firewall is additionally tightened through `bridge.runtime.firewallState`.
- A restrictive grant posture is produced with `capabilities.resolveEnvironment`, which narrows the advertised domains per applet identity until the user grants them, plus explicit `aclState.grant` calls. The runtime's permissive default is never reached for a domain the user has not granted.

**Consequences.** Four upstream gaps are filed against kehto/web rather than patched locally (kehto/web #397, #398, #399, #400): (1) forward the firewall hooks through `ShellAdapter`; (2) let the host choose the ACL default policy; (3) offer a hook that can hold or drop port traffic, since `onNappletMessage` runs before dispatch but its answer is ignored; (4) let the runtime firewall apply an unfocused multiplier, which needs (1)'s `getFocusContext` and a setter for `unfocusedMultiplier`; until then the runtime treats every window as focused. When any of them lands, the corresponding kernl layer shrinks (see D-012).

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

**Status in the first draft.** The profile is shell-wide and not persisted: `GuardFacade.setProfile` rebuilds the single pipeline, and windows already open keep the runtime rates installed at mount. Per-applet, remembered loosening is the target this decision describes and is tracked in `docs/roadmap.md`. The default remains `strict` on every boot, so the gap errs toward the user. kehto's experimental mitigation `experimental.nestedContextLock`, released in `@kehto/shell` 0.30.0, is enabled for every applet, and kernl adds its insertion lock on top (D-014).

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

**Consequences.** Preview behaviour is held to the same vocabulary and accessibility rules as the live shell, and to the same rules where it stands in for it: it asks before a write only for the kinds `@kernl/core`'s `isDestructiveKind` accepts and describes them with `describeChange`, its guard holds nothing back and stops an applet only by quarantine (D-012), it starts `strict` on every load, and its sample applets remove WebRTC the way kehto's prelude does. Sample applets are the first place a new mitigation is demonstrated.

**Reversal cost.** Low; the preview is one module behind the contract.

## D-012 · Guard enforcement is layered: the runtime firewall refuses, kernl's guard refuses through it, quarantine stops the triggering message

**Context.** kehto's bridge owns the `MessagePort` an applet speaks over, and exposes applet traffic to the host only through `ShellAdapter.onNappletMessage`. kehto's `dispatchEnvelope` calls that hook synchronously for each envelope, before it resolves the window's session and dispatches the envelope to the runtime, and ignores the hook's answer. The runtime then evaluates its own firewall, in the same synchronous call, before handing the envelope to a service. kernl cannot sit between the port and the runtime (D-001).

**Decision.** Enforcement is split by what each layer can do:

- **Refused before dispatch by kehto's runtime firewall: rates and the startup burst.** When an applet is mounted, kernl installs the guard profile's per-class rates and global rate in the runtime firewall (`applyRuntimeFirewallRules`, translating op classes through `RUNTIME_OP_CLASSES`), with exceed action `block`. It sets no policy, because kehto's `allow` policy makes `evaluate()` skip every rate, matcher and burst check. The runtime supplies `initElapsedMs`, so kehto's own startup burst guard also applies at kehto's default: more than 20 operations in a window's first 3 s are blocked. A refused envelope is answered with an error starting `firewall:`.
- **Refused before dispatch through the runtime firewall: everything kernl's own guard will not let through.** kehto's matchers cannot see the size of a download or query request, because the runtime measures only `envelope.event`, and the runtime knows nothing of focus or visibility. kernl's ingress guard, focus firewall and hidden-window check judge every envelope inside `onNappletMessage` with the shell's focus and visibility, and `GuardPipeline.observe` returns a disposition. For every `defer` or `reject` (an envelope over its size cap, `size:<class>`; a burst above kernl's per-second rate, `flood:burst` or `flood:queue-full`; a request over the smaller unfocused budget, the focus firewall's `rate:<class>`; or any non-control envelope from a window that is not visible, `hidden:<class>`), `createKernl` calls `refuseCurrentDispatch`, which sets the applet's runtime policy to `deny` for that one synchronous dispatch and restores the previous policy in a microtask, before the next port message can arrive. The applet receives a `firewall:` error and can retry; nothing it asked for is handled, and the user sees the guard event. Nothing is held: a burst envelope is not queued, and a hidden window's request is refused rather than deferred, so the applet retries once visible. Control envelopes (`classifyEnvelope` class `control`: `shell.*`, `inc.*`, `theme.*`, closes and the like) are never refused, so a window always stays controllable.
- **Quarantined: floods and hidden downloads past the allowance.** A `quarantine` disposition revokes the applet's binding inside that same callback, so kehto finds no session for the window, the message that crossed the limit is not dispatched, and the applet is closed.

The window-level `hello` is the one message kernl can hold or drop before kehto sees it.

**Consequences.** A hidden applet's requests fail instead of waiting: the gate cannot hold a port envelope, so the applet must retry once visible, and a hidden download past the allowance still quarantines. A hook that let the shell defer instead of refuse is kehto/web#399. The runtime firewall applies no unfocused multiplier, because kehto does not forward focus to it (D-001, gaps 1 and 4); the profile's multiplier is applied by kernl's focus firewall, whose rejections are refused through `refuseCurrentDispatch`. The runtime's refusals reach the applet but not the host, because `ShellAdapter` does not forward `onFirewallEvent`; the guard panel shows kernl's own count of the same rates. Rates are installed at mount, so a window keeps the rates it was mounted with when the profile changes. Earlier drafts of this entry said the rates were refused while kernl also set the `allow` policy that bypassed them, and until 2026-11-04 focus tightening, bursts and hidden activity were reported but still handled; `docs/alpha-status.md` records both. The upstream requests that would give kernl a true pre-dispatch hook are recorded with D-001's gaps.

**Reversal cost.** Low; the pipeline sits behind `createGuardPipeline` and shrinks when kehto exposes a hook that can hold or drop an envelope. `refuseCurrentDispatch` goes when kehto offers that hook and its runtime can measure the envelopes and focus it cannot see today.

## D-013 · The site is served at a domain root

**Context.** D-007 sets an agent-readiness score of 84 or higher. Measured with amiagentready on 2026-11-03, the scanner works on the **origin**: it scores the domain's homepage whatever path it is given, and reads `robots.txt` and `llms.txt` from the domain root. The scoring is reproducible from its response: each scored check contributes its weight, pass at full, warn at half, fail at zero.

**Measurement.** The Pages artifact served at the root of a temporary public origin, through `scripts/serve-pages.mjs`, scored **92** (12 pass, 2 warn, 0 fail; WebMCP detected). The two warns are "online booking" (kernl has none) and "schema coverage" (asks for local-business types such as opening hours and ratings, which do not apply). The same origin hosts `/docs/`, so the one score covers the website and the docs.

**Decision.** Production serves the Pages artifact at the root of its own domain, and the host answers `Accept: text/markdown` with the page's Markdown twin (`Vary: Accept`), as `scripts/serve-pages.mjs` does. The Pages workflow reads `SITE_URL` and `SITE_BASE` from repository variables, so a custom domain needs no code change.

**Consequences.** Served from the project subpath `kernlize.github.io/web/` (D-008's default), the score drops to about 82 because the origin has no `robots.txt` or `llms.txt`. A static host without content negotiation scores 90 at a root. Both regressions are visible in `docs/how-tos/deploy.md`.

**Production, 2026-11-03.** The artifact is published to the public `kernlize/kernlize.github.io` repository (built output only; this repository stays private) and served at https://kernlize.github.io/. Live amiagentready score: **90**, no failing checks; the site and `/docs/` share the score because the tool grades the origin. The browser suite, including the public-vocabulary walk-through, passes against the live URL (`PLAYWRIGHT_BASE_URL=https://kernlize.github.io`).

**Publishing is manual, by the maintainer's choice (2026-11-03).** `pnpm site:publish` builds, runs the vocabulary and agent-readiness gates, and pushes `.pages/` to the site repository. CI builds and audits on every push; it would publish only if a scoped `SITE_PUBLISH_TOKEN` were added, and none is.

**Superseded in part by D-019 (2026-11-04).** Production moved to https://kernl.run/ on bunny.net, and publishing is automatic on every push to `main`. The domain-root reasoning above still holds.

**Reversal cost.** Low; only deployment configuration.

## D-014 · Applets cannot open nested frames: kehto's nested-context lock, plus kernl's insertion lock

**Context.** An independent review showed that applet code could create a child `<iframe srcdoc>` whose fresh realm still had a working `RTCPeerConnection`, which gathered a server-reflexive candidate from a public STUN server. kehto's prelude removes the peer-connection globals from the applet's own realm only, and CSP cannot help: `about:srcdoc` and `about:blank` children involve no fetch, so `frame-src 'none'` and `child-src 'none'` never apply, and no shipped directive governs WebRTC. The probe in `tests/e2e/applet-network-sealed.spec.ts`, run against a srcdoc built by `@kehto/shell` 0.29.0 alone, reproduces it in Chromium: every scripted route it tries (`createElement`, `createElementNS`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `createContextualFragment`, `DOMParser` with `importNode` and `adoptNode`, `createDocument`, `createHTMLDocument`, `document.write`) produced a child realm that reported `host` and `srflx` candidates.

**Decision.** Opinion 3 in `SOUL.md` (the user outranks the applet developer) is met by enabling kehto's own mitigation. `planMount` passes `experimental: { nestedContextLock: true }` to `prepareNappletSrcdoc` from `@kehto/shell` 0.30.0 for every applet (D-003):

- kehto renders `require-trusted-types-for 'script'; trusted-types default` into the applet's CSP meta, and its prelude installs a Trusted Types `default` policy that refuses frame markup at every HTML string sink and pins `Document.prototype.createElement`, `createElementNS` and `DOMImplementation.prototype.createDocument` non-configurable to refuse frame tag names. Both throw `TypeError('kehto: napplets may not create nested browsing contexts')`.
- `planMount` runs kehto's `assertNappletHasNoFrame` on the verified bytes before they become a srcdoc, and maps its refusal of static `iframe`, `frame`, `frameset`, `object`, `embed`, `portal` or `fencedframe` markup to `denied:nested-frame`.

kehto's lock guards creation only, and a second independent review (2026-11-03) found four creation routes past it, each producing a child frame with a working peer connection that reached a public STUN server: a customized built-in element constructed with `new` (constructors skip `createElement`), XSLT `transformToFragment`, and an XHTML-parsed element with a namespace prefix moved in with `importNode` or `adoptNode` (kehto's string-sink pattern does not match prefixed tags). Creation routes are open-ended, so kernl adds a lock on **insertion** on top of kehto's: a frame gets a realm only when connected, and connecting goes through a small set of methods. `@kernl/guard`'s `appletInsertionLock` pins `appendChild`, `insertBefore`, `replaceChild`, `append`, `prepend`, `replaceChildren`, `before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `Range.insertNode` and `Range.surroundContents` on their owning prototypes to refuse, with `TypeError('denied:nested-frame')`, any node that is, or contains (descendants, template content, shadow roots), an HTML-namespace frame element. Node identity is read through native getters captured before applet code runs, so an element cannot disguise itself. It also refuses custom elements that extend frame elements and removes `XSLTProcessor`. `renderInsertionLockScript` emits it as `<script data-kernl-insertion-lock>`, and `planMount` inserts that immediately after kehto's prelude, before any applet script; when kehto's CSP meta and prelude are not where it expects them, the mount is refused with `unavailable:frame-lock` rather than run without the lock. The four routes are to be reported to kehto.

With both locks, the probe sees every creation route throw, the four bypass routes fail at creation or insertion, and thirteen insertion routes refuse an unconnected frame; it finds no child realm and no candidate in any realm, while the host page's control reaches the STUN server. The probe stays as the regression test.

**Consequences.** An applet that creates child frames, ships one in its markup, or registers its own Trusted Types policy (Angular, for one) is refused or breaks. That is the trade opinion 3 makes: an applet has no legitimate need for a nested browsing context inside a shell that already gives it a window. A string written to an HTML sink that merely mentions a frame tag, in text or an attribute, is refused too. Every DOM insertion in an applet walks the inserted subtree once.

**Reversal.** Drop `appletInsertionLock`, `renderInsertionLockScript` and the insertion in `planMount` once kehto guards insertion as well as creation. Turn `nestedContextLock` off only by reversing opinion 3 in `SOUL.md`.

**Update to D-014, 2026-11-04.** Until this date `@kernl/guard` carried an attributed port of kehto's lock from kehto main (4d8a5693), which no release then carried: its own Trusted Types policy and factory pins (`renderFrameLockScript`), the byte scan (`appletMarkupHasFrame`, `assertAppletHasNoFrame`), and `TRUSTED_TYPES_DIRECTIVES` spliced by `planMount` into the CSP meta kehto 0.29.0 rendered. `@kehto/shell` 0.30.0 ships the flag, so the port is replaced by kehto's released lock as above, and those exports and `AppletCsp.trustedTypes` are removed. Only the insertion lock remains kernl's.

## D-015 · Messaging backends are built on the account signer

**Context.** The first draft shipped every messaging provider unavailable. kehto's sealed-message adapter wants the owner's raw secret key, and kernl keeps keys only inside applesauce signer instances (`SOUL.md` opinion 1, `AGENTS.md` security posture). Browser extensions and remote signers never hand a key over at all, so an adapter that needs one would exclude most accounts and would make kernl the place a key leaks from.

**Decision.** `@kernl/core` builds its own backends from applesauce helpers and the active account's signer:

- `createPrivateMessagesBackend({ store, pool, tiers, signer, selfPubkey, now? })` sends NIP-17 messages: the kind 14 rumour is sealed in a kind 13 event that the account signer signs, encrypting with its `nip44`, and the seal is wrapped in a kind 1059 event signed by an ephemeral key. The ephemeral key is generated inside an applesauce `PrivateKeySigner`, used for that one wrap, and dropped with the signer; it is never persisted and never leaves the class.
- `createLegacyMessagesBackend(...)` sends NIP-04 kind 4 messages through `signer.nip04`, normalised the same way, and stays marked metadata-exposing (D-009).
- Delivery goes to the recipient's kind 10050 inbox relays. A recipient who publishes none is reached through the sender's `outbox` and `super` tiers, because a message that is never sent protects nobody and those are the relays the user already chose. A copy is wrapped to the sender. The subscription reads kind 1059 addressed to the user from the user's own inbox relays, or the same tiers when there are none. A conversation id is the sorted participant set.
- `createKernl` wires both unless `KernlOptions.messagingBackends` overrides them. Availability follows the active account: `private` needs a signer with `nip44`, `legacy` one with `nip04`. The reasons are `sign-in-required` with no active account and `signer-cannot-encrypt` when the signer lacks the method; `ratchet` keeps `no-runtime` (until D-016). `needs-local-key-signer` is gone.
- The shell's own Messages panel decrypts the user's messages without a consent prompt. The request comes from the shell, on the user's behalf, to show the user their own messages; a prompt there would ask the user whether they may read their mail. An applet reaches messages only through the NAP `dm` domain, which is a grant the user gives and can revoke, and through the guard's `dm:send` rate.

**Consequences.** Messaging works with every account type that can encrypt, including ones whose key kernl never sees. A remote signer or extension may ask its own question per decryption; kernl does not suppress it. A read-only account sees both providers unavailable with `signer-cannot-encrypt`. The inbox fallback means a recipient without inbox relays may never see a message sent to relays they do not read; the sender sees it delivered to those relays, not read. kehto's sealed-message adapter is not used; when it can take a signer instead of a key, the backend can be swapped behind `MessagingBackend` without a contract change (D-001).

**Reversal cost.** Low; both backends sit behind `MessagingBackend` and `KernlOptions.messagingBackends`.

## D-016 · Ratchet sessions run the library's runtime on the account signer, with its secrets sealed to the account

**Context.** D-009 lists `ratchet` and D-015 left it `no-runtime`. The published `nostr-double-ratchet` package (0.0.183) ships `NdrRuntime`, which models an account (owner) and its devices. It needs four things from the host: `nostrSubscribe`, `nostrPublish`, an optional `nostrSign` for the owner's events, and a `StorageAdapter`. `ownerIdentityKey` (the raw account key) is optional: it is used only to sign a local device-list snapshot early and as a compatibility input the library no longer encrypts with. The owner signs one thing, the kind 37368 device list; everything else (invites, kind 1059 invite responses, kind 1060 session messages) is signed and encrypted by a device key the library's `DelegateManager` generates, and by per-session ratchet keys. The library writes that device key and every session's state into the `StorageAdapter` in the clear. kehto's `createNdrDmAdapter` wraps an `NdrRuntimeLike`, but files every session event as a message (typing notices included), never initialises or registers the runtime, and has no notion of the active account.

**Decision.** `@kernl/core` runs the runtime without the account key and adapts it itself:

- `createRatchetMessagesBackend` builds one `NdrRuntime` per signed-in account, with transport over kernl's pool on the user's `outbox` and `super` tiers, and signs the owner's events with the account signer from their template (the library leaves `pubkey` empty, which an applesauce account rejects). It calls `initForOwner`, `ensureCurrentDeviceRegistered` and `republishInvite`, files only kind 14 rumours into the shared conversation store, and closes the runtime when the account changes. It is the default `ratchet` backend and is available while the signer has `nip44`.
- `createSealedRatchetStorage` is the library's `StorageAdapter`. Every value is encrypted to the account with the signer's `nip44` (chunked under the 64 KiB limit) and stored under an opaque slot number; the key-to-slot map, whose key names include correspondents' public keys, is sealed the same way. The library's device and session keys therefore exist in clear only inside the library's memory, never in kernl's storage and never in kernl code. This is the reading of `SOUL.md` opinion 1 this decision takes: kernl keeps and persists no raw key bytes; a library that must hold its own session keys may, and what it persists is ciphertext only the account can open.
- kehto's `createNdrDmAdapter` is not used, because it would file typing notices as messages and cannot follow the account; its `NdrRuntimeLike` shape is what kernl's backend drives.

**Consequences.** Ratchet sessions work with any account that can `nip44`, including extensions and remote signers, which may ask once per stored value per page load and on each write. Sessions are one to one; groups are not offered. Both sides must share a relay, because inbox relays are not consulted. The conversation list is in memory and empties on reload, while sessions and keys persist. The first use waits up to the library's device-list discovery timeouts (10 s and 2 s). Clearing site data ends this device's sessions. Applets reach ratchet through the `dm` domain with `ratchet:`-namespaced ids, like every provider.

**Reversal cost.** Low; the backend sits behind `MessagingBackend` and `KernlOptions.messagingBackends.ratchet`. Swapping to kehto's adapter needs it to filter rumour kinds and follow the account.

## D-017 · Magnet links download inside the shell; NZB, Soulseek and mail stay hand-off

**Context.** D-010 shipped the downloads, sharing and mail bridges as hand-offs: kernl rebuilds the address and the device's own app does the transfer. That works, but it sends the user out of kernl for the most common case, a file shared by peers. A page has exactly the network primitives the browser gives it: `fetch`, WebSocket and WebRTC. WebTorrent speaks BitTorrent over WebRTC data channels and finds peers through `wss://` trackers, so a magnet link can download inside the page. The other three protocols cannot: NZB downloads speak NNTP to a news server over raw TCP, Soulseek is its own protocol over raw TCP to a central server and to peers, and mail needs SMTP and IMAP over TCP. A browser page cannot open a raw TCP socket, so no amount of client code inside the shell can reach any of them.

**Decision.** `@kernl/bridges` adds `createWebTorrentBackend({ client, trackers?, now?, progressIntervalMs? })`. `client` is a structural `WebTorrentLike` (`add(magnet)`, `remove(torrent, { destroyStore })`) or a loader that returns one, so the package stays free of dependencies and the library loads only on the first download. The backend validates the hash (`invalid:info-hash`), keeps only the link's `wss://` trackers and appends `DEFAULT_WEBRTC_TRACKERS` (UDP and plain-TCP trackers are unreachable from a page), deduplicates by hash, and reports a client that fails to load or add as `unavailable:<why>`. Besides `add` it exposes `jobs()`, `subscribe(listener)`, `pause(id)`, `resume(id)`, `remove(id)` and `files(id)`, which hands finished files over as blobs; an unknown id is `denied:unknown-download` and an unfinished one `unavailable:not-finished`. Progress-only notifications are throttled to one per 500 ms. It carries no `handoff` trait, so `describeBridge` reports the transfer as kernl's own while keeping the torrent exposure: peers see the user's address, the transfer is not encrypted, and the activity is public.

`createDefaultBridges` takes an optional `torrent` backend that wins over the hand-off for the torrent bridge only; `KernlOptions.torrent` passes one through `createKernl`. The shell host page (`/app/`) installs `webtorrent` 3.0.21 at an exact version and imports its browser build lazily on the first download. The shell's torrent backend follows the user's choice in Settings, "Download in kernl" (the default where the browser has `RTCPeerConnection`) or "Open in an app on your device", remembered under `kernl:downloads:mode:v1`; `BackendTraits.handoff` is read on every availability check so the bridge's description follows the choice. A Downloads panel lists jobs with progress, pause, resume, remove and Save, which hands each file to the browser through a blob URL. The preview uses a client that reaches nobody and fills each download in over a few seconds.

NZB, Soulseek and mail stay hand-off. Running them inside kernl needs something that can open TCP sockets on the user's behalf: a companion service the user runs or chooses, which the shell would reach over WebSocket. That is on the roadmap, not in this draft.

**Consequences.** The WebRTC connections are the shell page's, never an applet's: applet frames keep the guard's CSP and kehto's prelude that removes WebRTC, and the host page's policy (`frame-src 'none'`, no `connect-src` limit) already permits WebRTC and `wss://`. A WebTorrent client in a browser reaches only WebRTC peers, which are fewer than a desktop client's, so a link whose swarm has no browser peers may never start; the job stays "Looking for peers" and the user can switch to the device app. Downloads live in memory for the page's lifetime; closing the tab drops them.

**Reversal cost.** Low. The backend sits behind `TorrentBackend`; removing `KernlOptions.torrent` restores the D-010 hand-off.

## D-018 · Every private-messaging protocol is a provider; group sessions run the Marmot library with its state sealed to the account

**Context.** SOUL opinion 5 asks kernl to carry any reasonable private-messaging protocol behind the one Direct Messenger contract, unranked. The NIPs index (November 2026) lists NIP-04 and NIP-17 (with NIP-44 and NIP-59) for direct messages, NIP-29 relay-based groups, NIP-28, NIP-C7, NIP-A4 and NIP-A0 for public chat, and NIP-EE, now marked unrecommended and superseded by the Marmot protocol (MLS, RFC 9420, over kinds 30443, 444 and 445). The nostr-double-ratchet draft lives outside the index (D-016). The maintained TypeScript Marmot implementation is `@internet-privacy/marmot-ts` (0.9.0, alpha, wire-compatible with the reference implementation, built on applesauce 7 and a vendored `ts-mls`). kehto's `createCordnDmAdapter` was considered and not used: it adapts a Cordn/ContextVM coordinator client, which kernl would have to supply, not an MLS runtime.

**Decision.**

- Every private, end-to-end encrypted protocol in that inventory is a provider: `legacy` (NIP-04), `private` (NIP-17), `ratchet` (D-016) and `group` (Marmot). The concept page keeps the inventory and each protocol's status.
- `group` runs `MarmotClient` per signed-in account. The account signer is the library's `EventSigner`: it signs identity proofs, key packages and invitation seals and opens invitations with `nip44`. The library generates and holds its MLS keys and group secrets. Every store it keeps goes through `createSealedGroupStore`, one value per store encrypted to the account with `nip44`, so `SOUL.md` opinion 1's key rule holds as in D-016. The network is an adapter over the shell's one pool.
- Using the provider publishes a key package for the account, so others can invite it. That is an addition to the public record, not a replacement, so it is not a consent prompt (SOUL opinion 2); the docs say it happens.
- A send to people reuses the group with exactly those members, else founds one. Messages are kept in memory: the library deletes per-message secrets once a message is read, so history cannot be read again, and keeping it sealed is roadmap work.
- NIP-29 is not a provider: its groups are readable by the relay that hosts them, so it is not private messaging in the sense opinion 5 means, and a group addressed by relay and id does not fit the `dm` recipient model. The public chat NIPs are out of scope.

**Consequences.** Group sessions work with any account that can `nip44`, including extensions and remote signers, which are asked once per sealed store per page load and on every write. An account is one member of a group, as the library enforces, so only one of a person's devices joins. Applets reach `group` like every provider, through the `dm` composite as `group:<group id>`. The vocabulary check also refuses "marmot" and "mls" on the public site.

**Reversal cost.** Low; the backend sits behind `MessagingBackend` and `KernlOptions.messagingBackends.group`. A host can replace it, or drop the provider by registering its own registry.

## D-019 · The site is served at kernl.run by a bunny.net static site, deployed on every push to main

**Context.** D-013 served the artifact at the root of `kernlize.github.io` from a public repository holding only built output, published by hand. The project now has its own domain, `kernl.run`. bunny.net static sites keep each deploy as an immutable directory in a storage zone and point a pull zone's edge rule at the live one, so publishing and rollback are a retarget and a cache purge. The same account already serves other sites from the maintainer's projects, deployed from GitHub Actions.

**Decision.** The bunny.net site `kernl` serves `.pages/` at https://kernl.run/. `.github/workflows/pages.yml` (Publish site) builds and audits on every push to `main` and deploys with `BunnyWay/actions/deploy-site`, pinned to the `deploy-site@0.1.2` commit, which records each deploy in the repository's Environments. Deploys are never cancelled in flight. The workflow needs one secret, `BUNNYNET_API_KEY`, and reads the variables `BUNNY_SITE`, `SITE_URL` and `SITE_BASE`; `scripts/setup-bunny-secrets.sh` sets all four from the bunny CLI login without prompting, so it is safe to re-run. `pnpm site:publish` deploys the same artifact from a checkout. The source defaults (`SITE_URL` and the absolute links in copy) name `https://kernl.run/`.

**Consequences.** Without the secret the workflow builds, audits and stops with a notice, as before. Rolling back is `bunny sites deployments publish --previous --force`. The account API key in the secret can manage every bunny.net resource on the account, not only this site; bunny.net offers no narrower key for site deploys. The pull zone does not yet answer `Accept: text/markdown` (D-013's 92 needs a middleware Edge Script implementing `scripts/serve-pages.mjs`'s rule), so the expected score at kernl.run is 90 until then. `kernlize.github.io` is no longer updated and can be retired.

**Reversal cost.** Low; only deployment configuration and the default origin.
