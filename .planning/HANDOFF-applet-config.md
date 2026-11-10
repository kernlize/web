# Handoff: applet settings (NAP-CONFIG)

Branch `feat/applet-config`, based on main after PR #26. The core is done and tested. The web shell does not offer `config` yet.

## Done (committed)
- `packages/core/src/applets/applet-config.ts`: `createAppletConfig({ storage, appletOf, present })` returns kehto `ConfigServiceOptions`.
  - Values are kept per applet catalogue id in `kernl:applet-config:v1`, so an update keeps them.
  - `openSettings` calls `present({ title, section?, context })`. kehto's `context.commit(values)` validates, saves and publishes.
- `KernlHost.presentSettings?` is new and optional. `createKernl` registers `config` only when the host provides it, so the domain is offered only then (kehto conformance).
- Specs:
  - `packages/core/features/applet-config.feature`.
  - A kernl scenario where an applet registers a schema, opens settings, the form commits `level: 4`, and the applet reads it back.
  - 51 scenarios across the two specs pass.

## To do
1. **Web form:** `apps/web/src/shell/AppletSettings.svelte`, shown from `host.presentSettings` (wire it the way `presentConsent` and the consent queue are wired; see `host.ts` and `Shell.svelte`).
   - Render `context.schema.properties`:
     - string → text, or a select when it has `enum`
     - number/integer → number input with `minimum`/`maximum`
     - boolean → checkbox
     - group by the section extension
     - mask secret fields
   - On save call `context.commit(values)`. Show an error if it throws.
   - Any logic goes in a `.ts` with a Gherkin feature in `apps/web/features`, because shell `.ts` needs 100% coverage. Svelte is covered by e2e.
   - Add the preview implementation, and a Playwright test (preview).
2. **Paperwork:** D-036 in `DECISIONS.md` (next free number; check main first), a docs row in `docs/packages/core.md` for `createAppletConfig`/`SettingsPrompt`/`presentSettings`, and a changeset (minor, core).
3. **Ship:** `pnpm check` (the machine has been heavily loaded by other sessions, so heavy crypto scenarios can time out locally; CI is the authority), PR, CI, ask the user before merging, then verify on kernl.run that applets needing `config` are no longer marked.

## Context
- Goal: better nostr compatibility, always extensible.
- Shipped so far:
  - #19: profiles, NIP-65/66, streaming store, partial publishes, cache
  - #21: the store lists everything
  - #23: Blossom uploads (D-033)
  - #26: social actions (D-035)
- After `config`, the remaining capabilities are `mesh`, `fs`, `cvm`, `webrtc` and `gamepad`.
