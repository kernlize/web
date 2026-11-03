# Security posture

The rules the shell keeps when it runs untrusted code next to the user's identity. Each rule has a scenario in `features/` or a check in `scripts/`; a rule with neither is a wish.

## Mount rules

1. **`srcdoc`, never `src`.** The applet document is the verified bytes with the shell prelude and CSP injected outside the signed content. A `src` URL would give the applet an origin and a network path the shell does not mediate.
2. **`sandbox="allow-scripts"` only.** Never `allow-same-origin`, never `allow-top-navigation`, never `allow-popups`. The frame has an opaque origin and cannot reach the shell's storage or DOM.
3. **The guard's CSP, unchanged by profile.** `createAppletCsp(profile)` is applied through `prepareNappletSrcdoc`; it returns the same policy for every profile. No grant, profile or setting alters it. See [Guard](../concepts/guard.md#why-csp-never-loosens).
4. **`denyNappletControllerAccess(frame)`** before the frame is attached, so the applet cannot reach a service worker or controller the shell registered.
5. **Order: register → set environment → observe frame → assign `srcdoc`.** `originRegistry.register(contentWindow, windowId, identity)`, then `originRegistry.setEnvironment(contentWindow, environment)`, then `bridge.observeFrame(frame, windowId)`, then `frame.srcdoc = plan.srcdoc`. Assigning `srcdoc` first would let the document's first message arrive before the shell knows who it is.
6. **Remove the iframe on every revocation reason.** `window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed` and `host` all end with the frame gone and the guard's state for the window forgotten. A revoked window's identity is never re-bound to the same frame.

## Identity rules

7. **Verified bytes come from `@kehto/nip/5d` `resolveNapplet`.** Gateways and caches are accelerators; the hash is the identity. Cached bytes are re-verified on every read.
8. **Identity is `(dTag, artifactHash)` plus one port.** Grants are keyed by that identity; a new build is a new identity with no grants.
9. **Restrictive by narrowing.** `resolveEnvironment` returns only granted domains; kehto intersects, so the hook can only remove. The runtime's permissive default is never reached for an ungranted domain.

## Key rules

10. **Keys live only inside applesauce signer instances.** `ExtensionSigner`, `NostrConnectSigner`, `PasswordAccount`'s wrapped signer. kernl never holds raw key bytes and never serialises a private key outside `PasswordAccount`.
11. **Applets never see `window.nostr`.** The sandbox has no extension injection, and the shell does not forward one.
12. **Every signature the applet asks for goes through consent or an existing grant**, and destructive kinds (0, 3, 5, 10002) are shown as semantic diffs before signing.

## Network rules

13. **No applet network path exists outside the shell.** All bytes arrive through the `resource` domain and a bridge. The HTTP bridge enforces `https` only, 3 redirects, 10 MiB, 20 s and a private-address block re-checked on every hop.
14. **One `RelayPool`.** No service, provider or bridge opens its own connection. Adapters over the shared pool satisfy kehto's contracts.
15. **Hidden windows are deferred, not served.** The visibility gate holds their traffic; the hidden resource allowance caps their requests.

## Log rules

16. **Secrets never appear in logs, guard events or consent summaries.** `GuardEvent.reason` is a stable prefixed string; `NappletRevocation.detail` never includes message payloads; `describeChange` output names fields, not key material.
17. **Guard events are shown to the user**, with the applet and the reason. They are not sent anywhere.

## Dependency rules

18. **`nostr-tools` is never imported by kernl source.** It is a transitive peer of kehto and applesauce only.
19. **Published packages have zero framework dependencies.** `svelte`, `react`, `vue`, `preact`, `solid-js` and `lit` are forbidden in every `packages/*/package.json`.
20. **Leaf packages do not import `@kehto/*`**, except `@kernl/guard`, which imports `@kehto/firewall`. Only `@kernl/core` composes kehto.

Rules 18 to 20 are enforced by `scripts/check-dependency-rules.mjs` (`pnpm check:deps`). Rules 1 to 17 are scenarios in `packages/*/features/` and `features/`, and the mount rules are additionally exercised in the browser by the Playwright suite.

## Reporting

A posture violation is a bug of the highest severity in this repository, above any feature. Report it as an issue on `kernlize/web` with the rule number. If it involves a kehto seam, the issue is filed upstream too, and `DECISIONS.md` records the gap.
