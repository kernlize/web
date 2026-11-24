# Handoff: phase 4 multiplayer move (#72), and what follows

Written 2026-11-24. Read `.planning/HANDOFF-composability.md` (the owner's plan, in the main checkout) first; this note covers only where the work stopped.

## Where things stand

- Phases 1–3 are merged and closed (#69, #70, #71). Phase 4 (#72) has three of five moves merged: intents #97, bridges #98, downloads #99.
- Decisions made with the owner along the way: D-061 (levels, four questions settled), D-062 (module host), D-065 (a module may hold the active signer; consent is the applets' guarantee). D-063 and D-064 are other sessions' (media, theme change).
- Every PR: worktree from `origin/main`, spec first, `pnpm check` green, the full live e2e suite green, then ask the owner before merging. Port 4178 is often taken: serve with `PAGES_PORT=4191 node scripts/serve-pages.mjs` and run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4191 npx playwright test`. A live-path change needs a live test proven to fail without it.

## This branch: `feat/multiplayer-module` (commit 80d2c9c, WIP)

Done: `modules/multiplayer.ts` (`multiplayerModule({ remoteTools, directConnections })`, api `kernl.multiplayer`, services `cvm` and `webrtc`), `KernelContext.holds(windowId, domain)` (read-only grant check), the kernel passes `remoteTools: null` to `createKernlServices` and no longer builds remote tools or direct connections, `cvm`/`webrtc` left `KERNEL_DOMAINS`, `ModuleMembers` gains `multiplayer`, `kernlModules` forwards `remoteTools`/`directConnections`, a no-module scenario and a `needs-multiplayer` refusal in `modules.feature`. Type-check and all core and web tests pass.

Left before a PR:

1. Coverage. `createKernlServices` still wires `webrtc` and reads `deps.multiplayer` (the person's settings) for `cvm`; nothing exercises either now. Drop the `webrtc` wiring and `multiplayer`/`directConnections`/`identities` deps from `createKernlServices` (keep its `cvm` with `remoteTools`, which `services.feature` covers), and note it in the changeset.
2. Coverage. The module's `cvm` `relays` and `registry` lambdas are not reached by a composed-shell scenario: add one (an applet granted `cvm` asks `cvm.discover` in a shell with the multiplayer module; the pool is asked on the `super` tier), or reuse `multiplayer-settings.feature`'s "a live kernl shell" steps.
3. Coverage. Two option-forwarding branches in `createKernl`'s and `kernlModules`' long spreads are uncovered; consider having `kernlModules` take the `KernlOptions` fields directly so `createKernl` passes `options` through instead of re-spreading each field.
4. Docs (`docs/packages/core.md` module rows, `ModuleMembers`, `kernlModules` signature, `KernelContext.holds`; `docs/concepts/modules.md`; architecture rows for `cvm`/`webrtc`), a `minor` changeset, `pnpm check`, the live e2e suite (`direct-connections-live`, `remote-tools-live`, `meeting-settings-live` cover this path), PR against #72, ask before merging.

## Then

- Messaging (#72's last move): `dm` as a projection over provider sub-modules, each its own import; `messagingBackends` and the `ownsMessaging` bookkeeping go; assert on the built output that a shell with only `privateDm()` does not bundle the ratchet or group libraries. Close #72 when its done-when holds: a shell with no modules offers only the kernel's domains and passes the floor features.
- Phase 5 (#73, typed asks; breaking after one minor) can start once #72 is merged; phases 6–8 follow the order in the plan.
