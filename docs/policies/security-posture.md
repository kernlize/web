# Security posture

The rules the shell keeps when it runs untrusted code next to the user's identity. Each rule has a scenario in `features/` or a check in `scripts/`; a rule with neither is a wish.

## Mount rules

1. **`srcdoc`, never `src`.** The applet document is the verified bytes with the shell prelude and CSP injected outside the signed content. A `src` URL would give the applet an origin and a network path the shell does not mediate.
2. **`sandbox="allow-scripts"` only.** `mountApplet` sets the attribute to exactly `allow-scripts`, replacing any tokens the host set. Never `allow-same-origin`, never `allow-top-navigation`, never `allow-popups`. The frame has an opaque origin and cannot reach the shell's storage or DOM.
3. **The guard's CSP, unchanged by profile.** `createAppletCsp(profile)` is applied through `prepareNappletSrcdoc`; it returns the same policy for every profile. No grant, profile or setting alters it. See [Guard](../concepts/guard.md#why-csp-never-loosens).
4. **`denyNappletControllerAccess(frame)`** on the attached, still empty frame, before any applet document exists, so the applet cannot reach a service worker or controller the shell registered.
5. **Order: attached empty frame → harden → register → set environment → observe frame → assign `srcdoc`.** The host attaches the iframe to the document first, with no `src` or `srcdoc` (`mountApplet` throws `invalid:frame-detached` without a `contentWindow`). Then `mountApplet` sets `sandbox` and the controller policy, `originRegistry.register(contentWindow, windowId, identity)`, then `originRegistry.setEnvironment(contentWindow, environment)`, then `bridge.observeFrame(frame, windowId)`, then `frame.srcdoc = plan.srcdoc`. Assigning `srcdoc` first would let the document's first message arrive before the shell knows who it is.
6. **Remove the iframe on every revocation reason.** `window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed` and `host` all end with the frame gone and the guard's state for the window forgotten. A revoked window's identity is never re-bound to the same frame.

## Identity rules

7. **Verified bytes come from `@kehto/nip/5d` `resolveNapplet`.** Gateways and caches are accelerators; the hash is the identity. Cached bytes are re-verified on every read.
8. **Identity is `(dTag, artifactHash)` plus one port.** Grants are keyed by that identity; a new build is a new identity with no grants.
9. **Restrictive by narrowing.** `resolveEnvironment` returns only granted domains; kehto intersects, so the hook can only remove. The runtime's permissive default is never reached for an ungranted domain.

## Key rules

10. **Keys live only inside applesauce signer instances.** `ExtensionSigner`, `NostrConnectSigner`, `PasswordAccount`'s wrapped signer. kernl never holds raw key bytes and never serialises a private key outside `PasswordAccount`.
11. **Applets never see `window.nostr`.** The sandbox has no extension injection, and the shell does not forward one.
12. **Destructive signatures wait for the user.** An applet can ask for a signature only through a granted domain. When an applet window asks the shell to sign a destructive kind (0, 3, 5, 10002 and the list kinds 10000–10099, 30000–30099), `@kernl/core`'s consent gate shows the change as a semantic diff through `host.presentConsent` and waits; a denial fails with `denied:consent` and nothing is signed or published. Both routes pass the gate: `relay.publish` through the signer kernl returns from `ShellAdapter.auth.getSigner(windowId)`, and `outbox.publish` in kernl's outbox service wrapper, because kehto's outbox service signs without naming the window. The shell's own signing, with no window, is not gated. Routine kinds are signed without a prompt, and answers are not remembered. kehto's runtime has no such step; this rule is kernl's.

## Network rules

13. **No applet network path exists outside the shell.** All bytes arrive through the `resource` domain and a bridge. The HTTP bridge enforces `https` only, 10 MiB, 20 s and a private-address block. In Node and on servers it follows up to 3 redirects by hand and re-checks every hop; in a browser a redirect is opaque to it and is refused with `denied:redirect-unverifiable`. Hostnames are checked as literals only: no resolver is wired, so a public name that resolves to a private address is not caught. Browser fetches are also subject to CORS: a request the browser blocks is `unavailable:network Failed to fetch`, and any other status-0 answer is `unavailable:network <type> response`.
14. **One `RelayPool`.** No service, provider or bridge opens its own connection. Adapters over the shared pool satisfy kehto's contracts.
15. **Hidden windows get a smaller budget, not a pause.** The visibility gate holds only a hidden window's window-level `hello`; port traffic is dispatched and observed afterwards ([D-012](../decisions.md#d-012)). A hidden window counts at the unfocused budget, and its `resource.*` requests past the hidden allowance quarantine it.

## Log rules

16. **Secrets never appear in logs, guard events or consent summaries.** `GuardEvent.reason` is a stable prefixed string; `NappletRevocation.detail` never includes message payloads; `describeChange` output names fields, not key material.
17. **Guard events are shown to the user**, with the applet and the reason. They are not sent anywhere.

## Dependency rules

18. **`nostr-tools` is never imported by kernl source.** It is a transitive peer of kehto and applesauce only.
19. **Published packages have zero framework dependencies.** `svelte`, `react`, `vue`, `preact`, `solid-js` and `lit` are forbidden in every `packages/*/package.json`.
20. **Leaf packages do not import `@kehto/*`**, except `@kernl/guard`, which imports `@kehto/firewall`. Only `@kernl/core` composes kehto.

Rules 18 to 20 are enforced by `scripts/check-dependency-rules.mjs` (`pnpm check:deps`). Rules 1 to 17 are scenarios in `packages/*/features/` and `features/`, and the mount rules are additionally exercised in the browser by the Playwright suite.

## Reporting

A posture violation is a bug of the highest severity in this repository, above any feature. Report it to the maintainers with the rule number; the source repository is private during the alpha. If it involves a kehto seam, the issue is filed upstream too, and `DECISIONS.md` records the gap.
