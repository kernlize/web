# DECISIONS.md

Architecture decisions for kernl, newest last. Each entry records what was decided, why, and what it would take to reverse it. A decision stays here after it is reversed; it gets a `Superseded by` line instead of being deleted.

Format: `D-NNN · title` → Context, Decision, Consequences, Reversal cost.

---

## D-001 · kernl composes kehto; it does not fork it

**Context.** kehto publishes `@kehto/{acl,firewall,runtime,shell,services,nip,wm}` as the unopinionated NIP-5D toolkit. kernl is the opinionated shell. Two of kehto's seams are narrower than kernl wants: `ShellAdapter` does not forward `getFocusContext`, `onFirewallEvent` or `firewallPersistence` to the runtime, and `createRuntime` hardcodes the ACL default policy to `'permissive'`. The transport internals (`createNip5dTransport`, `createShellReadyState`) are not exported, so kernl cannot assemble its own bridge from kehto parts.

**Decision.** kernl depends on the published `@kehto/*` packages at pinned minor ranges and uses `createShellBridge` unchanged. Behaviour kehto does not expose is built in front of the bridge, not inside a fork:

- Focus-aware rate limiting runs in `@kernlize/guard` using the pure `@kehto/firewall` `evaluate()` engine with focus supplied by kernl's window manager. The runtime's built-in firewall is additionally tightened through `bridge.runtime.firewallState`.
- A restrictive grant posture is produced with `capabilities.resolveEnvironment`, which narrows the advertised domains per applet identity until the user grants them, plus explicit `aclState.grant` calls. The runtime's permissive default is never reached for a domain the user has not granted.

**Consequences.** Four upstream gaps are filed against kehto/web rather than patched locally (kehto/web #397, #398, #399, #400): (1) forward the firewall hooks through `ShellAdapter`; (2) let the host choose the ACL default policy; (3) offer a hook that can hold or drop port traffic, since `onNappletMessage` runs before dispatch but its answer is ignored; (4) let the runtime firewall apply an unfocused multiplier, which needs (1)'s `getFocusContext` and a setter for `unfocusedMultiplier`; until then the runtime treats every window as focused. When any of them lands, the corresponding kernl layer shrinks (see D-012).

**Reversal cost.** Low. Both local layers sit behind interfaces in `@kernlize/guard` and `@kernlize/core` and can be deleted when upstream provides the hook.

**Superseded in part by D-020.** All four gaps are closed in `@kehto/shell` 0.32.0, `@kehto/runtime` 0.28.0 and `@kehto/firewall` 0.7.0. The restrictive posture now comes from `aclDefaultPolicy`, and the runtime firewall receives focus, the profile's multiplier and burst guard, and an event sink. The focus-aware firewall in `@kernlize/guard` stays, for the reasons D-020 gives.

## D-002 · applesauce v7 is the only event layer

**Context.** kehto's reference runtime (Paja) uses `nostr-tools` `SimplePool`. kernl's first opinion is that applesauce is the event layer.

**Decision.** `applesauce-core` (`EventStore`), `applesauce-relay` (`RelayPool`), `applesauce-signers`, `applesauce-accounts` (`AccountManager`) and `applesauce-loaders` are the only libraries kernl source imports for events, relays, signing and accounts. `nostr-tools` is a peer dependency of `@kernlize/core`, because kehto and applesauce require it; kernl source does not import it. kehto's `RelayPoolLike`, `RelayPoolServiceOptions` and `DmRelayPool` contracts are satisfied by thin adapters over one shared `RelayPool` in `@kernlize/core/applesauce`.

**Consequences.** One pool, one store, one account manager per shell. A guard test fails the build if `nostr-tools` is imported from kernl source.

**Reversal cost.** High by design. The adapters are small, but the opinion is the point.

## D-003 · Every kehto mitigation ships on, in its strict profile

**Context.** Opinion three in `SOUL.md`.

**Decision.** `@kernlize/guard` exposes three profiles, `strict`, `balanced` and `relaxed`. The hosted shell boots in `strict`. The target is that the user loosens the profile per applet; in this draft the user changes one shell-wide profile from the guard panel (see Status below), never a developer flag in the hosted shell. An embedding host may choose the starting profile (`KernlOptions.guard.profile`), which changes limits only; the sandbox, the CSP, the frame lock and consent are fixed. The mitigations and their defaults are listed in `docs/concepts/guard.md` and surfaced in the UI as a readable list with reasons.

**Consequences.** Some applets will hit limits in `strict`. The guard emits an event for every rejection and deferral so the user can see what happened and decide.

**Status in the first draft.** The profile is shell-wide and not persisted: `GuardFacade.setProfile` rebuilds the single pipeline, and windows already open keep the runtime rates installed at mount. Per-applet, remembered loosening is the target this decision describes and is tracked in `docs/roadmap.md`. The default remains `strict` on every boot, so the gap errs toward the user. kehto's experimental mitigation `experimental.nestedContextLock`, released in `@kehto/shell` 0.30.0, is enabled for every applet, and kernl adds its insertion lock on top (D-014).

**Reversal cost.** A one-line profile change for a user; a `SOUL.md` amendment for the project.

**Superseded in part by D-020.** A profile change now reinstalls the runtime rates of every open window and sets the runtime's unfocused multiplier and startup burst guard, so open windows no longer keep the rates they were mounted with.

## D-004 · Four packages, one app, one docs site

**Context.** The repository needs a shape that lets docs, tests and publishing stay per-package without forcing the shell UI into a framework-free constraint.

**Decision.**

| Workspace | Name | Role | Framework |
|---|---|---|---|
| `packages/guard` | `@kernlize/guard` | Ingress flood control, visibility gate, focus-aware firewall, CSP profile, nested-frame lock, mitigation descriptions. Pure. | none |
| `packages/messaging` | `@kernlize/messaging` | Messaging provider contract, registry, composite NAP-DM adapter, provider descriptions. Pure. | none |
| `packages/bridges` | `@kernlize/bridges` | Locator parsing, bridge contract, registry, resource resolver with SSRF policy. Pure. | none |
| `packages/core` | `@kernlize/core` | Composition root: applesauce adapters, applet resolution and mount plan, consent summaries, layouts, persistence. Browser-agnostic. | none |
| `apps/web` | `@kernlize/web` | Landing site at `/` and the shell at `/app/`. | Astro 7, Svelte 5 islands |
| `docs` | `@kernlize/docs` | Documentation at `/docs/`. | VitePress |

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

**Decision.** `@kernlize/bridges` defines a `Bridge` with a user-facing `label` (`downloads`, `mail`) and a list of locator schemes (`magnet:`, `nzb:`, `slsk:`, `mailto:`). The first draft ships a complete HTTP bridge with SSRF policy and four parsers with backend interfaces (`TorrentBackend`, `NzbBackend`, `SoulseekBackend`, `MailBackend`). Without a backend, a bridge reports `unavailable` and the shell shows that honestly. Backends are out of scope for this draft and are tracked in `docs/roadmap.md`.

**Consequences.** The bridge contract is exercised end to end by the HTTP bridge, so later backends plug into a tested path.

**Reversal cost.** Low.

## D-011 · Preview mode is a product feature, not a test double

**Context.** The shell needs to be usable without an account, a network or a published applet: for people evaluating it, for the Playwright suite, and for the landing page's "open" form when nothing real is reachable.

**Decision.** `apps/web/src/shell/preview-kernl.ts` implements the same `Kernl` contract as `@kernlize/core` using the real `@kernlize/guard`, `@kernlize/messaging` (memory backend with a scripted correspondent) and `@kernlize/bridges` packages, a real applesauce `AccountManager`, and two sample applets whose `srcdoc` carries the guard's CSP and exercises consent, notifications, flooding and link opening. `?preview=1` selects it; the live path falls back to it only when `createKernl` is unavailable, and says so in a notice.

**Consequences.** Preview behaviour is held to the same vocabulary and accessibility rules as the live shell, and to the same rules where it stands in for it: it asks before a write only for the kinds `@kernlize/core`'s `isDestructiveKind` accepts and describes them with `describeChange`, its guard holds nothing back and stops an applet only by quarantine (D-012), it starts `strict` on every load, and its sample applets remove WebRTC the way kehto's prelude does. Sample applets are the first place a new mitigation is demonstrated.

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

**Superseded in part by D-020.** kehto now offers that hook. Port traffic is decided by `ShellAdapter.filterNappletMessage`: what kernl's guard will not let through is dropped rather than refused, a hidden window's requests are held and released when it is visible, and `refuseCurrentDispatch` is deleted. The runtime firewall now applies the unfocused multiplier and reports its refusals to the guard log. The size, burst, focus and quarantine layers described above remain kernl's.

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

kehto's lock guards creation only, and a second independent review (2026-11-03) found four creation routes past it, each producing a child frame with a working peer connection that reached a public STUN server: a customized built-in element constructed with `new` (constructors skip `createElement`), XSLT `transformToFragment`, and an XHTML-parsed element with a namespace prefix moved in with `importNode` or `adoptNode` (kehto's string-sink pattern does not match prefixed tags). Creation routes are open-ended, so kernl adds a lock on **insertion** on top of kehto's: a frame gets a realm only when connected, and connecting goes through a small set of methods. `@kernlize/guard`'s `appletInsertionLock` pins `appendChild`, `insertBefore`, `replaceChild`, `append`, `prepend`, `replaceChildren`, `before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `Range.insertNode` and `Range.surroundContents` on their owning prototypes to refuse, with `TypeError('denied:nested-frame')`, any node that is, or contains (descendants, template content, shadow roots), an HTML-namespace frame element. Node identity is read through native getters captured before applet code runs, so an element cannot disguise itself. It also refuses custom elements that extend frame elements and removes `XSLTProcessor`. `renderInsertionLockScript` emits it as `<script data-kernl-insertion-lock>`, and `planMount` inserts that immediately after kehto's prelude, before any applet script; when kehto's CSP meta and prelude are not where it expects them, the mount is refused with `unavailable:frame-lock` rather than run without the lock. The four routes are to be reported to kehto.

With both locks, the probe sees every creation route throw, the four bypass routes fail at creation or insertion, and thirteen insertion routes refuse an unconnected frame; it finds no child realm and no candidate in any realm, while the host page's control reaches the STUN server. The probe stays as the regression test.

**Consequences.** An applet that creates child frames, ships one in its markup, or registers its own Trusted Types policy (Angular, for one) is refused or breaks. That is the trade opinion 3 makes: an applet has no legitimate need for a nested browsing context inside a shell that already gives it a window. A string written to an HTML sink that merely mentions a frame tag, in text or an attribute, is refused too. Every DOM insertion in an applet walks the inserted subtree once.

**Reversal.** Drop `appletInsertionLock`, `renderInsertionLockScript` and the insertion in `planMount` once kehto guards insertion as well as creation. Turn `nestedContextLock` off only by reversing opinion 3 in `SOUL.md`.

**Update to D-014, 2026-11-04.** Until this date `@kernlize/guard` carried an attributed port of kehto's lock from kehto main (4d8a5693), which no release then carried: its own Trusted Types policy and factory pins (`renderFrameLockScript`), the byte scan (`appletMarkupHasFrame`, `assertAppletHasNoFrame`), and `TRUSTED_TYPES_DIRECTIVES` spliced by `planMount` into the CSP meta kehto 0.29.0 rendered. `@kehto/shell` 0.30.0 ships the flag, so the port is replaced by kehto's released lock as above, and those exports and `AppletCsp.trustedTypes` are removed. Only the insertion lock remains kernl's.

## D-015 · Messaging backends are built on the account signer

**Context.** The first draft shipped every messaging provider unavailable. kehto's sealed-message adapter wants the owner's raw secret key, and kernl keeps keys only inside applesauce signer instances (`SOUL.md` opinion 1, `AGENTS.md` security posture). Browser extensions and remote signers never hand a key over at all, so an adapter that needs one would exclude most accounts and would make kernl the place a key leaks from.

**Decision.** `@kernlize/core` builds its own backends from applesauce helpers and the active account's signer:

- `createPrivateMessagesBackend({ store, pool, tiers, signer, selfPubkey, now? })` sends NIP-17 messages: the kind 14 rumour is sealed in a kind 13 event that the account signer signs, encrypting with its `nip44`, and the seal is wrapped in a kind 1059 event signed by an ephemeral key. The ephemeral key is generated inside an applesauce `PrivateKeySigner`, used for that one wrap, and dropped with the signer; it is never persisted and never leaves the class.
- `createLegacyMessagesBackend(...)` sends NIP-04 kind 4 messages through `signer.nip04`, normalised the same way, and stays marked metadata-exposing (D-009).
- Delivery goes to the recipient's kind 10050 inbox relays. A recipient who publishes none is reached through the sender's `outbox` and `super` tiers, because a message that is never sent protects nobody and those are the relays the user already chose. A copy is wrapped to the sender. The subscription reads kind 1059 addressed to the user from the user's own inbox relays, or the same tiers when there are none. A conversation id is the sorted participant set.
- `createKernl` wires both unless `KernlOptions.messagingBackends` overrides them. Availability follows the active account: `private` needs a signer with `nip44`, `legacy` one with `nip04`. The reasons are `sign-in-required` with no active account and `signer-cannot-encrypt` when the signer lacks the method; `ratchet` keeps `no-runtime` (until D-016). `needs-local-key-signer` is gone.
- The shell's own Messages panel decrypts the user's messages without a consent prompt. The request comes from the shell, on the user's behalf, to show the user their own messages; a prompt there would ask the user whether they may read their mail. An applet reaches messages only through the NAP `dm` domain, which is a grant the user gives and can revoke, and through the guard's `dm:send` rate.

**Consequences.** Messaging works with every account type that can encrypt, including ones whose key kernl never sees. A remote signer or extension may ask its own question per decryption; kernl does not suppress it. A read-only account sees both providers unavailable with `signer-cannot-encrypt`. The inbox fallback means a recipient without inbox relays may never see a message sent to relays they do not read; the sender sees it delivered to those relays, not read. kehto's sealed-message adapter is not used; when it can take a signer instead of a key, the backend can be swapped behind `MessagingBackend` without a contract change (D-001).

**Reversal cost.** Low; both backends sit behind `MessagingBackend` and `KernlOptions.messagingBackends`.

## D-016 · Ratchet sessions run the library's runtime on the account signer, with its secrets sealed to the account

**Context.** D-009 lists `ratchet` and D-015 left it `no-runtime`. The published `nostr-double-ratchet` package (0.0.183) ships `NdrRuntime`, which models an account (owner) and its devices. It needs four things from the host: `nostrSubscribe`, `nostrPublish`, an optional `nostrSign` for the owner's events, and a `StorageAdapter`. `ownerIdentityKey` (the raw account key) is optional: it is used only to sign a local device-list snapshot early and as a compatibility input the library no longer encrypts with. The owner signs one thing, the kind 37368 device list; everything else (invites, kind 1059 invite responses, kind 1060 session messages) is signed and encrypted by a device key the library's `DelegateManager` generates, and by per-session ratchet keys. The library writes that device key and every session's state into the `StorageAdapter` in the clear. kehto's `createNdrDmAdapter` wraps an `NdrRuntimeLike`, but files every session event as a message (typing notices included), never initialises or registers the runtime, and has no notion of the active account.

**Decision.** `@kernlize/core` runs the runtime without the account key and adapts it itself:

- `createRatchetMessagesBackend` builds one `NdrRuntime` per signed-in account, with transport over kernl's pool on the user's `outbox` and `super` tiers, and signs the owner's events with the account signer from their template (the library leaves `pubkey` empty, which an applesauce account rejects). It calls `initForOwner`, `ensureCurrentDeviceRegistered` and `republishInvite`, files only kind 14 rumours into the shared conversation store, and closes the runtime when the account changes. It is the default `ratchet` backend and is available while the signer has `nip44`.
- `createSealedRatchetStorage` is the library's `StorageAdapter`. Every value is encrypted to the account with the signer's `nip44` (chunked under the 64 KiB limit) and stored under an opaque slot number; the key-to-slot map, whose key names include correspondents' public keys, is sealed the same way. The library's device and session keys therefore exist in clear only inside the library's memory, never in kernl's storage and never in kernl code. This is the reading of `SOUL.md` opinion 1 this decision takes: kernl keeps and persists no raw key bytes; a library that must hold its own session keys may, and what it persists is ciphertext only the account can open.
- kehto's `createNdrDmAdapter` is not used, because it would file typing notices as messages and cannot follow the account; its `NdrRuntimeLike` shape is what kernl's backend drives.

**Consequences.** Ratchet sessions work with any account that can `nip44`, including extensions and remote signers, which may ask once per stored value per page load and on each write. Sessions are one to one; groups are not offered. Both sides must share a relay, because inbox relays are not consulted. The conversation list is in memory and empties on reload, while sessions and keys persist. The first use waits up to the library's device-list discovery timeouts (10 s and 2 s). Clearing site data ends this device's sessions. Applets reach ratchet through the `dm` domain with `ratchet:`-namespaced ids, like every provider.

**Reversal cost.** Low; the backend sits behind `MessagingBackend` and `KernlOptions.messagingBackends.ratchet`. Swapping to kehto's adapter needs it to filter rumour kinds and follow the account.

## D-017 · Magnet links download inside the shell; NZB, Soulseek and mail stay hand-off

**Context.** D-010 shipped the downloads, sharing and mail bridges as hand-offs: kernl rebuilds the address and the device's own app does the transfer. That works, but it sends the user out of kernl for the most common case, a file shared by peers. A page has exactly the network primitives the browser gives it: `fetch`, WebSocket and WebRTC. WebTorrent speaks BitTorrent over WebRTC data channels and finds peers through `wss://` trackers, so a magnet link can download inside the page. The other three protocols cannot: NZB downloads speak NNTP to a news server over raw TCP, Soulseek is its own protocol over raw TCP to a central server and to peers, and mail needs SMTP and IMAP over TCP. A browser page cannot open a raw TCP socket, so no amount of client code inside the shell can reach any of them.

**Decision.** `@kernlize/bridges` adds `createWebTorrentBackend({ client, trackers?, now?, progressIntervalMs? })`. `client` is a structural `WebTorrentLike` (`add(magnet)`, `remove(torrent, { destroyStore })`) or a loader that returns one, so the package stays free of dependencies and the library loads only on the first download. The backend validates the hash (`invalid:info-hash`), keeps only the link's `wss://` trackers and appends `DEFAULT_WEBRTC_TRACKERS` (UDP and plain-TCP trackers are unreachable from a page), deduplicates by hash, and reports a client that fails to load or add as `unavailable:<why>`. Besides `add` it exposes `jobs()`, `subscribe(listener)`, `pause(id)`, `resume(id)`, `remove(id)` and `files(id)`, which hands finished files over as blobs; an unknown id is `denied:unknown-download` and an unfinished one `unavailable:not-finished`. Progress-only notifications are throttled to one per 500 ms. It carries no `handoff` trait, so `describeBridge` reports the transfer as kernl's own while keeping the torrent exposure: peers see the user's address, the transfer is not encrypted, and the activity is public.

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

## D-020 · kehto's host seams replace kernl's workarounds; kernl's guard still decides first

**Context.** D-001 recorded four kehto gaps (kehto/web #397, #398, #399, #400) and D-012 built kernl's enforcement around them. kehto/web PR #409 closed all four. `@kehto/shell` 0.32.0 forwards `getFocusContext`, `onFirewallEvent` and `firewallPersistence` through `ShellAdapter`, takes `aclDefaultPolicy`, and adds `filterNappletMessage`, which answers `dispatch`, `drop` or `defer` for each port envelope, with `ShellBridge.releaseDeferred(windowId)` and a new revocation reason, `deferred-overflow`, for a window holding more than `MAX_DEFERRED_MESSAGES` (1024). `@kehto/runtime` 0.28.0 lets a policy the host sets replace the stored one on load. `@kehto/firewall` 0.7.0 adds `setUnfocusedMultiplier` and `setBurstGuard`, also on `FirewallStateContainer`. A second change is pending: [kehto/web#336](https://github.com/kehto/web/pull/336) makes the firewall a shared approval authority and moves rate limiting into a separate runtime budget. On a host that configures `permissions` it ignores `setUnfocusedMultiplier`, `setBurstGuard`, `onFirewallEvent` and `firewallPersistence`, reads only `focused` from `getFocusContext`, and keeps `aclDefaultPolicy`, `filterNappletMessage` and `releaseDeferred` unchanged.

**Decision.** kernl depends on the released packages: `@kehto/shell` ^0.32.0, `@kehto/runtime` ^0.28.0, `@kehto/firewall` ^0.7.0, `@kehto/acl` ^0.20.3 and `@kehto/services` ^0.30.1, which requires `@napplet/core` 0.38 and `@napplet/nap` 0.37. It builds first on the seams that survive #336:

- **Port traffic is decided before the runtime sees it.** `createShellAdapter` passes `filterNappletMessage`, which runs `GuardPipeline.observe` and returns kehto's decision. `refuseCurrentDispatch` and kernl's use of `onNappletMessage` are deleted. What kernl's guard will not let through is dropped: an oversized download or query, a burst above the per-second rate, a request over the focus firewall's budget, and the envelope that triggers a quarantine. A dropped request gets no reply, which is kehto's documented spec gap (NAP defines no answer for a request a host drops); before, the applet got a `firewall:` error.
- **Hidden windows are held.** A non-control envelope from a window that is not visible is deferred, reported as a `defer` guard event `hidden:<class>`, and counted against `deferQueue`; past it, it is dropped with `defer:queue-full`. When the window becomes visible the pipeline calls `onRelease`, and kernl calls `bridge.releaseDeferred(windowId)`; kehto dispatches the held envelopes in order through the ACL and the runtime firewall. A hidden download past `hiddenResourceAllowance` still quarantines, and kehto discards what the window held. `deferQueue` (200 in `strict`, 600 in `relaxed`) is below `MAX_DEFERRED_MESSAGES`, so kernl drops before kehto would revoke; `deferred-overflow` is still handled the way every revocation is, by removing the frame. kehto queues every later envelope behind held ones, so once a hidden window holds anything its control requests wait too.
- **The ACL is restrictive.** The adapter sets `aclDefaultPolicy: 'restrictive'`. `KernlGrants.ensure` grants the baseline and what the user allowed, and revokes only what the applet's stored entry holds beyond that (a domain the user took back, or an entry kept from the permissive posture), instead of writing every capability. The environment resolver still narrows what is advertised. Nothing is granted until the user grants it.
- **The runtime firewall knows focus and the profile.** `getFocusContext` returns `{ focused }` from the pipeline's visibility; it does not send `msSinceFocusGain`, which #336 ignores. On boot and on every profile change, `applyRuntimeFirewallProfile` sets the profile's `unfocusedMultiplier` and `burstGuard` (`{ windowMs: 1000, maxOps: ingressBurst, action: 'block' }`) and kernl reinstalls the rates of every open window. The runtime's startup burst is now the profile's, 8 operations in a window's first second in `strict`, instead of kehto's default of 20 in 3 s.
- **Runtime refusals reach the guard log without the message.** `createRuntimeFirewallHooks` turns each `onFirewallEvent` into a `GuardEvent` (`rate:<class>`, `flood:startup`, or `runtime:<ruleId>`) and drops the applet message the runtime attaches, so nothing the applet sent reaches the log. It keeps the runtime firewall's configuration under `kernl:firewall:v1` in the host's storage. These report only what the runtime itself refuses: the startup burst, and held envelopes over budget at release. Everything kernl decides is reported by kernl's own layers, so the log does not depend on these hooks.
- **The seams #336 retires live in one module.** Every call into the runtime firewall's configuration (`setRateLimit`, `setGlobalRate`, `setUnfocusedMultiplier`, `setBurstGuard`, `persist`) and both hooks are in `packages/core/src/guard/runtime-rules.ts`.

**What kernl still puts in front of kehto, and why.** The ingress guard, the visibility gate and the focus firewall stay. kehto's runtime measures only an envelope's `event`, so size caps on downloads and queries are kernl's. It knows nothing of visibility, so holding hidden windows and the hidden download allowance are kernl's. Flood quarantine is kernl's. The window-level `hello` still passes the pipeline before `bridge.handleMessage`. The focus firewall now overlaps the runtime, which applies the same rates and multiplier, and it stays for three reasons: it has a separate budget for deletions, which the runtime counts as `relay:write`; its matchers can use `msSinceFocusGain`, which #336's budgets ignore; and once #336 lands a configured host gets no runtime event for a stored deny and only `onRateLimit` for budgets, so kernl's own decisions must stay a complete source of guard events.

**When kehto/web#336 lands.** In `runtime-rules.ts`, `applyRuntimeFirewallRules` and `applyRuntimeFirewallProfile` become one call to `runtime.permissions.setRateLimit`, built from the current `rateLimit`; `onFirewallEvent` becomes `onRateLimit`; `firewallPersistence` and `kernl:firewall:v1` go. `getFocusContext`, `aclDefaultPolicy`, `filterNappletMessage` and `releaseDeferred` stay as they are. kernl will also have to decide how admission approvals meet the restrictive ACL, which #336 treats as a ceiling.

**Consequences.** An applet whose request kernl drops waits for a reply that does not come, and has to time out. Because the focus firewall counts the same rates before the runtime does, a request over a class budget is normally dropped by kernl rather than refused by the runtime with a `firewall:` error; the runtime's own refusals are met mostly in a window's first second and for held requests released over budget. A hidden applet no longer has to retry. Held requests meet the runtime firewall at release, at the window's focus at that moment. A real applet that sends more than 8 operations, control included, in its first second under `strict` has the excess refused by the runtime with `firewall:` errors. `@kernlize/core` drops `refuseCurrentDispatch` and changes `GuardPipeline.observe` and `ShellAdapterDeps`, which is a minor release on 0.x.

**Reversal cost.** Low. The decisions sit behind `GuardPipeline.observe` and `createShellAdapter`; the runtime firewall calls sit in one module.

## D-021 · Registry scopes are explicit; package versions have one authority

**Context.** npm belongs to `@kernlize`, while JSR belongs to `@kernl`. A shared name cannot address both registries directly.

**Decision.** Workspace manifests, source imports and Changesets use `@kernlize/*`. npm ships the existing ESM build and declarations. JSR publishes a generated TypeScript workspace named `@kernl/*`, with relative source imports resolved and internal imports mapped to the corresponding JSR packages. Its versions come from package.json; external dependency versions come from the installed lockfile. The same source APIs, including npm-valued `PACKAGE_NAME` constants, ship to both registries.

**Consequences.** There is no second set of versions to synchronize. CI checks actual packed npm consumers and runs a JSR publish dry-run. Registry owners must configure publication rights separately; the release guide records those settings. Only release.yml publishes, after validation; retries skip existing versions.

**Reversal cost.** Low before publication: revert the scope migration and release tooling. After publication, existing consumers depend on these names; maintain them or publish a migration release.

## D-022 · Window management is one replaceable interface; layouts are a registry; both live in the core behind a light entry

**Context.** How a shell manages its windows is the opinion most likely to be disagreed with: a tiling desktop, tabs, workspaces and a single-applet kiosk are all reasonable, and none is safer than another. kernl's shell had that opinion spread through a Svelte store that hardcoded two modes, `floating` and `tiled`, and carried its own copy of the dwindle arrangement, while `@kernlize/core` exported four `LayoutStrategy` values the shell never called. A developer could change the arrangement only by editing the store, and could not replace the rest (cascade, clamping, focus, stacking, minimising, the narrow-screen mode) at all. One thing in that store is not a matter of taste: what it tells the guard about each window's visibility and focus, which decides whether an applet's requests are held and how large its budget is.

**Decision.**

- `@kernlize/core` gains a `LayoutRegistry` (`createLayoutRegistry`, `createDefaultLayouts`) and a `WindowManager` interface with kernl's own implementation, `createWindowManager`. The manager holds no DOM: a shell feeds it events and draws from the state it publishes on `state$`. The shell's two hardcoded modes become the registry's four layouts, and the shell's copy of dwindle is deleted in favour of `createDwindleLayout`.
- The tiling strategies take a `margin` separate from `gap`, so the shell keeps 8 px between windows and none at the desktop edge, and they round rectangle edges rather than sizes, so neighbours never overlap or leave a hole.
- A strategy is told the front-most window is the focused one. Real focus drops to nothing whenever the person opens one of the shell's panels, and an arrangement that follows focus would reshuffle each time.
- The pieces are also exported from `@kernlize/core/wm`, a second entry that imports only `rxjs`. The shell loads the core on demand, so the preview (D-011) starts without it, and it needs its window manager before that; importing it from the main entry would pull the network stack into the first screen.
- The shell app decides its window management in one file, `apps/web/src/shell/windows.ts`: `createShellLayouts` and `createShellWindowManager`. `WindowStore` shrinks to which applet is in which window, and knows the manager only through the interface. The chosen layout is stored by id under `kernl:layout:v1`; `tiled`, which earlier builds stored, reads as `dwindle`.
- The interface carries one fixed obligation, written on the interface and in the how-to: what the manager tells the guard about a window must be true. Everything else is the implementation's choice.

**Consequences.** A layout of a developer's own is one `register` call, and a different window manager is one function's return value; the how-to builds a tabbed one in about a hundred lines and it runs in the shell with no other change. An embedding host can use the same manager outside the shell. kernl's own manager keeps the visibility semantics the store had: a window is visible when the page is and the window is neither minimised nor stopped. It does not detect a window wholly covered by another, so on a narrow desktop the windows behind the front one are still reported visible; that is recorded in the alpha status rather than changed here, because tightening it changes what the guard holds and deserves its own decision. `@kernlize/core`'s type declarations are emitted once per entry, so the window-management types exist in both; they are structurally identical.

**Reversal cost.** Low for the shell: `windows.ts` is the only file that names an implementation. Medium for the package: `@kernlize/core/wm` is a published entry point, and removing it is a breaking change.

## D-023 · The landing is one screen and two paths; the long-form pages live under /about/; motion is one WebGL stage driven by a timeline library

**Context.** The site's home page had grown to six sections: what an applet gets, the five opinions, the alpha's state, the price and the questions, on top of the hero. All of it is true and none of it tells a developer what to do next. Two readers arrive ready to act and had no route: one has an application and wants to run applets inside it, the other is starting a shell. The site was also a set of separate page loads, with a fade-in on scroll as its only motion.

**Decision.**

- `/` is three sections. A hero that fits the first screen at any size, with one sentence, the preview and a link down the page. Two adoption paths side by side, three steps each, a sample and the tutorial that carries on: "Embed kernl in a page" for an existing application, "Run the shell" for a new shell. Then the open-by-address form. The paths say plainly that both start from a copy of the source during the alpha.
- Everything the home page used to hold stays, unchanged, at `/about/`, and the five pages beneath it move to `/about/<page>/`. The prefix is the constant `ABOUT` in `apps/web/src/lib/site.ts`. The old addresses are Astro redirects, so links to them keep working; a redirect stub gets a one-line Markdown twin and is left out of `llms.txt`.
- The site's pages use Astro's `ClientRouter`, so a move between them replaces the page's contents without reloading the document. `/app/` does not take part: it has no router, so it is always a fresh load and its frame policy is in the HTML the server sent, as the security posture requires.
- Motion is one persistent `<canvas>` drawn with three.js and timed with GSAP. Behind the home page's hero it draws the guard as a rail and requests as marks that meet it: refused, held or passed. Between pages the same canvas comes to the front and a panel crosses the screen, covering the old page while the new one loads and uncovering it; the new page's content then rises into place, and later sections do the same as they scroll in (`ScrollTrigger`). The stage reads its colours from the theme tokens.
- Motion is an addition, never a condition. With reduced motion there is no canvas, no curtain and nothing starts hidden. Without WebGL the hero keeps a still rail drawn in CSS and navigation is plain. Without scripts every page is whole. If the motion script fails to arrive, a timer in the page head stops hiding anything after four seconds.

**Consequences.** `apps/web` gains two runtime dependencies, `three` and `gsap`; three.js loads in its own chunk after the page is interactive, and neither is loaded on `/app/`. GSAP ships under its own no-charge licence rather than MIT, which is acceptable for the site and would not be for a published package. Scripts on the site's pages run once per visit rather than once per page, so listeners that outlive a page sit on the document (the theme toggle, the open form), and the root element's theme attribute is put back after every swap. The header offers two links on the landing and the six long-form pages under `/about/`.

**Reversal cost.** Low. Removing `<ClientRouter />` and `<Stage />` from `Site.astro` returns the site to plain page loads with nothing else to change; moving the pages back is a rename and the redirect list.

## D-024 · Outside a secure context the shell fills in Web Crypto from audited pure-JS primitives

**Context.** kernl is meant to be reachable from overlay networks: an onion service, or a FIPS mesh address, served over plain HTTP because the network already authenticates and encrypts the path. A browser treats such a page as an insecure context and withholds `crypto.subtle` and `crypto.randomUUID`, keeping only `crypto.getRandomValues`. The shell's dependencies call both: the applet runtime and its applet-side prelude for request ids, applesauce for remote-signer transports, the MLS group stack for HPKE (X25519, HKDF, AES-GCM) and Ed25519 signatures, the download client for SHA-1 and SHA-256. Over such an address the shell stopped at the sign-in screen with `crypto.randomUUID is not a function`.

**Decision.**

- `@kernlize/core/crypto` exports `installCryptoFallback`. It adds `crypto.randomUUID`, built on `getRandomValues`, and a `crypto.subtle` from `createFallbackSubtle`, built on `@noble/hashes`, `@noble/ciphers` and `@noble/curves`. It never replaces an implementation the platform has, so over HTTPS it does nothing.
- The fallback covers only what the shell's dependencies call: SHA-1/256/384/512 digests; HMAC and Ed25519 sign and verify; AES-GCM (128-bit tag) and AES-CBC; X25519 and HKDF `deriveBits`; Ed25519 and X25519 keys in `raw`, `pkcs8` and `jwk`. Anything else rejects with `NotSupportedError`, as a browser does for an algorithm it lacks. Its output matches the platform's byte for byte, which the features check against Node's Web Crypto.
- `crypto-fallback.ts` is the first module `Shell.svelte` imports, so the fallback is in place before any other module evaluates. It is its own entry for the same reason `wm` is (D-022): the shell loads the core on demand.
- An applet frame is an opaque origin and inherits its parent's insecure context, so the mount plan puts a `randomUUID` fallback script after the insertion lock (D-014) and before any applet script. Applets get only `randomUUID`; an applet that needs `crypto.subtle` must bring its own.

**Consequences.** `@kernlize/core` gains three direct dependencies, all already in the tree through the MLS stack. Key material made by the fallback lives in JavaScript memory rather than behind the browser's non-extractable key boundary; `extractable: false` is honoured by `exportKey` but is not a hardware or process boundary. The fallback is not constant-time beyond what the noble libraries guarantee. Both are acceptable for an address the person chose to reach over an authenticated overlay, and neither applies over HTTPS, where the platform's implementation is used.

**Reversal cost.** Low. Deleting the import in `Shell.svelte` and the script in the mount plan returns the shell to the platform's Web Crypto alone.

## D-025 · An address opens if any relay the shell knows can answer; the live shell is tested in a browser against a network the test owns

**Context.** An applet that opened in every other shell failed in kernl's with "Could not open the applet." The sentence is the launcher's fallback for a failure that carries none of kernl's reason prefixes, so the shell could not say what went wrong, and neither could the person reporting it. Other applets opened in the same browser minutes later, and the address opened in clean Chromium and Firefox profiles against the published build with the reporter's own relay settings, so the cause was a moment in one session and was not recovered. Looking for it found a class of failure, not one bug. `fetchManifestEvent` handed the lookup to the relay library with its defaults and passed its errors through: every relay failing surfaced as `All relays failed`; a relay that accepts a connection and hangs up is left pending by applesauce-relay 7 whatever `reconnect` and `firstResponseTimeout` say, so a lookup that met only such relays ended thirty seconds later as `Timeout has occurred`; a relay hint that is not a URL threw `Invalid URL`; and the library's default of stopping three seconds after the first relay reports the end of its stored events let a quick relay with nothing to say cut off a slower catalogue, which reads as "no such applet". The lookup also asked only the relays the address named and the `apps` tier, so one catalogue relay having a bad minute was enough to fail an applet that general relays also held. Past the lookup, the launcher offered a switch for every domain an applet named, including ones the shell does not serve, and switching one on made **Run** fail with `invalid:domain`; and an applet granted `identity` under a read-only account was told nobody was signed in. None of this was visible to the tests: every resolve scenario scripted the pool, and every browser test ran the preview, which never touches the core, a relay or a blob server.

**Decision.**

- A lookup is decided by the relays that answer, in at most two rounds. The first asks the address's hints, filtered to `ws:`/`wss:` URLs, plus the `apps` tier. When it does not produce the manifest, the second asks the `super` tier. A manifest is an ordinary event that authors also publish to general relays; asking them only after the first round keeps a normal lookup on the relays the address chose.
- Each round carries kernl's own completion rule with three clocks, `MANIFEST_TIMING`: `settleMs` (3 s) after the first manifest, for a newer release elsewhere; `patienceMs` (8 s) after the first relay that answers with nothing, for a slower relay that has it; `timeoutMs` (10 s) for a round in which nothing answers.
- A round whose relays all refused the connection is asked once more after `retryDelayMs` (1 s). Public relays answer a websocket upgrade with 502 or 503 for a moment and accept the next one; on the day of the report three of the shell's default general relays were doing so from the reporter's network, which left a lookup resting on one relay, and applesauce-relay 7 fails a relay on its first refused connection whatever `reconnect` says. A round that ran out its clock is not asked again.
- Every way a lookup can fail has a reason. A relay answered and none had the manifest: `unavailable:manifest`. No relay answered in either round: `unavailable:network`. The launcher has a sentence for each, and when it does fall back to the generic sentence it writes the underlying error to the console as a warning, because that case is a defect to report, not a state to explain. The raw reason still never reaches the page (D-006).
- `decodePointer` finds an encoded address inside a link or a sentence, since that is how addresses are shared.
- A domain the shell does not offer is listed in the launcher, disabled and marked, and never passed to `grants.allowDomain`. `allowDomain` still refuses it with `invalid:domain` for any other caller.
- The `identity` service gets a `getPublicKey`-only view of a read-only account. `getSigner` stays null for it everywhere else, so writes are refused as before.
- Tests dial. `packages/core/features/live-lookup.feature` runs the real relay pool and the default blob fetcher against relays and a blob server on loopback ports, including relays that are down, silent, slow, stale or hang up. `tests/e2e/shell-live.spec.ts` runs the live shell in Chromium and in Firefox, since the engines fail sockets and fetches differently, against relays answered through `routeWebSocket` and blob servers through `route`; relay hosts it does not name hang up, so the suite never reaches the public network. `tests/e2e/shell-live-network.spec.ts` opens published applets over the public network and runs only with `KERNL_PUBLIC_NETWORK=1`: it is the check after a deploy, not a gate that fails a commit because somebody's relay was down.

**Consequences.** An address fails only when no relay in its hints, the `apps` tier or the `super` tier produces the manifest, and it always ends in a sentence that names what happened. The slowest outcome is two rounds of ten seconds, reached only when every relay accepts connections and says nothing; refused connections cost one extra second and a second attempt per round. A relay that answers with nothing costs at most eight seconds of waiting for the others in its round, where it used to cost three and a wrong answer. A lookup the address's relays cannot serve is now also seen by the general relays. Applets that list an unserved domain as optional open; ones that require it open with a warning that they may not work here. `ws` is a development dependency of `@kernlize/core`, for the loopback relays.

**Reversal cost.** Low. The clocks are one constant and one optional argument; removing the completion rule restores the library default, and the fallback is one entry in a list of rounds.

## D-026 · The shell has a store, and applets hand work to each other through intents

**Context.** The launcher offered two hard-coded sample applets and a field for pasting an address, so finding an applet meant being handed its address. Applets advertise what they are for in their signed manifests: `t` tags for topics, `R`/`O` for the domains they need and can use, and `z`/`i` for the roles and requests they take (NAP-INTENT). kehto ships NAP-INTENT as `createIntentService`, `createCatalogIntentResolver` and `manifestToIntentCatalogEntry`, and a shell offers the `intent` domain by answering `ShellAdapter.intent.isAvailable()`. A user's preferred handlers can be published as kind 31129 ("Napplet Handler Preferences"), which an applet such as an intent-preferences manager can also write. kehto's ACL (0.20.3, also on `main`) maps `intent.deliver` to no recipient capability, so the runtime's recipient-checked `sendToEligibleNapplet` refuses every delivery; kehto's own reference host, Paja, posts the delivery on the target's bound port with `originRegistry.postToNapplet`.

**Decision.**

- **The launcher is a store.** `kernl.catalog.load()` (`loadCatalog`) reads root and named manifests from the `apps` and `super` tiers within an 8 s budget, keeps those whose signature verifies (`toCatalogEntry`), and lists the newest per catalogue id. `searchCatalog` matches every search word against title, topics, roles, description and publisher, forgiving a typo only within one word; `popularTopics` gives the store's topic bubbles. By default the store lists only applets whose required domains this shell offers, and says how many it hides. An entry's bytes are verified only when it is opened. Pasting an address into the search always works, and `?open=` still opens one.
- **There are no samples.** The preview's store lists the preview's own applets, shaped as store entries; a third, Profiles, takes `napplet:profile/open`, so the preview shows the whole intent flow offline.
- **Planning installs.** `kernl.plan` installs the verified applet (`kernl:installed:v1`), and `kernl.install` installs one without opening it, refusing a summary the shell did not verify (`invalid:unresolved`). The installed set is the catalogue NAP-INTENT resolves against, so a handler's contracts always come from a verified manifest. `AppletSummary.address` carries the manifest's shareable address so the shell can open a handler again.
- **kernl offers `intent`, routed by kehto's resolver.** `createIntentRouter` wraps `createCatalogIntentResolver` with the user's local default per archetype, their published preferences (one compatible preferred handler is used without asking; several are offered first in the chooser), the host's chooser, and recommendations matched only to installed handlers. When nothing installed can take a request, the user is asked once, with the store narrowed to applets that accept the convention; a handler installed that way is used for that request through a one-time explicit authorisation, so an applet never addresses a handler the user did not pick. Without a chooser an undecided request is refused as `invoke rejected`.
- **Delivery goes over the target's port, behind the receiving grant.** `createIntentDelivery` reuses a running handler (focused unless asked not to) or asks the host to open it, then retries until the target's live session holds `intent:read` and posts `intent.deliver` with `originRegistry.postToNapplet`, as Paja does. The sender is the verified catalogue id of the asking window, from kernl's own handles. A failure after acceptance is told to the user in plain words.
- **Receiving is a grant.** An applet that takes requests is offered the "opening other applets" switch, on at its first run, and an applet that requires it to ask others gets it on too.
- **Handler preferences are the user's.** kind 31129 events are read for the signed-in account from its `outbox` and `super` relays, verified and kept per archetype; public entries are read, private ones are carried over untouched. A local default always wins. Publishing a choice is off until the user turns on "Keep these choices with your account", because the archetype is public. An applet that writes kind 31129 meets the destructive consent prompt, which names the archetype and the applets added and removed.

**Consequences.** A store lists other people's titles and descriptions as they wrote them. Its icons load from the manifest's first server, a display accelerator and never identity. Delivery depends on `originRegistry.postToNapplet` until kehto maps `intent.deliver` to `intent:read`; the gap is to be raised upstream. The preferences' private entries are not decrypted, and kehto's `getDefaultHandler` takes only the archetype, so a convention-specific choice can only rank the chooser.

**Reversal cost.** Low. The store and router are additive; the delivery send is one function in `kernl-intents.ts`.
