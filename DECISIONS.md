# DECISIONS.md

Architecture decisions for kernl, newest last. Each entry records what was decided, why, and what it would take to reverse it. A decision stays here after it is reversed; it gets a `Superseded by` line instead of being deleted.

Format: `D-NNN · title` → Context, Decision, Consequences, Reversal cost.

---

## D-001 · kernl composes kehto; it does not fork it

**Context.** kehto publishes `@kehto/{acl,firewall,runtime,shell,services,nip,wm}` as the unopinionated NIP-5D toolkit. kernl is the opinionated shell. Two of kehto's seams are narrower than kernl wants: `ShellAdapter` does not forward `getFocusContext`, `onFirewallEvent` or `firewallPersistence` to the runtime, and `createRuntime` hardcodes the ACL default policy to `'permissive'`. The transport internals (`createNip5dTransport`, `createShellReadyState`) are not exported, so kernl cannot assemble its own bridge from kehto parts.

**Decision.** kernl depends on the published `@kehto/*` packages at pinned minor ranges and uses `createShellBridge` unchanged. Behaviour kehto does not expose is built in front of the bridge, not inside a fork:

- Focus-aware rate limiting runs in `@kernl/guard` using the pure `@kehto/firewall` `evaluate()` engine with focus supplied by kernl's window manager. The runtime's built-in firewall is additionally tightened through `bridge.runtime.firewallState`.
- A restrictive grant posture is produced with `capabilities.resolveEnvironment`, which narrows the advertised domains per applet identity until the user grants them, plus explicit `aclState.grant` calls. The runtime's permissive default is never reached for a domain the user has not granted.

**Consequences.** Four upstream gaps are recorded against kehto/web rather than patched locally: (1) forward the firewall hooks through `ShellAdapter`; (2) let the host choose the ACL default policy; (3) offer a pre-dispatch hook on port traffic, since `onNappletMessage` is observe-only; (4) expose a setter for the runtime firewall's `unfocusedMultiplier`. When any of them lands, the corresponding kernl layer shrinks (see D-012).

**Reversal cost.** Low. Both local layers sit behind interfaces in `@kernl/guard` and `@kernl/core` and can be deleted when upstream provides the hook.

## D-002 · applesauce v7 is the only event layer

**Context.** kehto's reference runtime (Paja) uses `nostr-tools` `SimplePool`. kernl's first opinion is that applesauce is the event layer.

**Decision.** `applesauce-core` (`EventStore`), `applesauce-relay` (`RelayPool`), `applesauce-signers`, `applesauce-accounts` (`AccountManager`), `applesauce-loaders` and `applesauce-factory` are the only libraries kernl source imports for events, relays, signing and accounts. `nostr-tools` stays a transitive peer dependency required by kehto and applesauce; kernl source does not import it. kehto's `RelayPoolLike`, `RelayPoolServiceOptions` and `DmRelayPool` contracts are satisfied by thin adapters over one shared `RelayPool` in `@kernl/core/applesauce`.

**Consequences.** One pool, one store, one account manager per shell. A guard test fails the build if `nostr-tools` is imported from kernl source.

**Reversal cost.** High by design. The adapters are small, but the opinion is the point.

## D-003 · Every kehto mitigation ships on, in its strict profile

**Context.** Opinion three in `SOUL.md`.

**Decision.** `@kernl/guard` exposes three profiles, `strict`, `balanced` and `relaxed`. The shell boots in `strict`. The profile can be loosened per applet by the user through the grants panel, never globally by configuration. The mitigations and their defaults are listed in `docs/concepts/guard.md` and surfaced in the UI as a readable list with reasons.

**Consequences.** Some applets will hit limits in `strict`. The guard emits an event for every rejection and deferral so the user can see what happened and decide.

**Reversal cost.** A one-line profile change for a user; a `SOUL.md` amendment for the project.

## D-004 · Four packages, one app, one docs site

**Context.** The repository needs a shape that lets docs, tests and publishing stay per-package without forcing the shell UI into a framework-free constraint.

**Decision.**

| Workspace | Name | Role | Framework |
|---|---|---|---|
| `packages/guard` | `@kernl/guard` | Ingress flood control, visibility gate, focus-aware firewall, CSP profile, mitigation descriptions. Pure. | none |
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

**Decision.** URLs in package metadata point at `https://github.com/kernlize/web`. The Pages artifact is built with a configurable `SITE_BASE` (default `/`) and `SITE_URL`; the Pages workflow sets them to `/web/` and `https://kernlize.github.io/web/`. When a domain is chosen, only the workflow environment changes.

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

**Consequences.** Preview behaviour is held to the same vocabulary and accessibility rules as the live shell. Sample applets are the first place a new mitigation is demonstrated.

**Reversal cost.** Low; the preview is one module behind the contract.

## D-012 · Guard enforcement is layered: configured before dispatch, reactive after

**Context.** kehto's bridge owns the `MessagePort` an applet speaks over, and exposes applet traffic to the host only through the observe-only `onNappletMessage` hook. kernl cannot sit between the port and the runtime (D-001).

**Decision.** Two layers. Before dispatch, kernl configures kehto's own runtime firewall from the guard profile (`applyNappletRules` on bind, `firewallState.setRateLimit`), so kehto rejects over-budget envelopes itself. After dispatch, kernl's ingress guard, visibility gate and focus firewall observe the same traffic with the shell's focus and visibility; a `quarantine` disposition revokes the applet's binding, and every other non-pass disposition is surfaced to the user as a guard event. The window-level `hello` is the one message kernl filters before kehto sees it.

**Consequences.** Deferral while hidden is advisory in this draft: the applet's envelope has already reached the runtime by the time the gate observes it, so the gate's effect is the tightened budget and the event trail, not a held queue. The upstream request that would make it a true pre-dispatch hook is recorded with D-001's gaps.

**Reversal cost.** Low; the pipeline sits behind `createGuardPipeline` and shrinks when kehto exposes a pre-dispatch hook.
