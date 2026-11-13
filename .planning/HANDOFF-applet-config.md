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

## Also done
- Web form: `apps/web/src/shell/AppletSettings.svelte` over `settings-form.ts` (spec `apps/web/features/shell-settings.feature`), wired through `host.presentSettings` and a `SettingsQueue` in `Shell.svelte`.
- Preview: `preview-config.ts` runs kehto's config service over `createAppletConfig`; the Notes sample has "Open its settings" (`preview-settings.feature`, Playwright in `shell-preview.spec.ts`).
- D-036, docs rows in `docs/packages/core.md`, changeset `applet-config.md` (minor, core).
- Local: web specs 100% coverage on touched files, slop 100, docs gate, vocabulary/agent-ready/links, 32 Playwright tests green. Some crypto and script scenarios time out locally under load (load average ~120), including on unchanged main; CI is the authority.

## To do
1. CI green on the PR; ask the user before merging.
2. After deploy, verify on kernl.run that applets needing `config` are no longer marked.

## Context
- Goal: better nostr compatibility, always extensible.
- Shipped so far:
  - #19: profiles, NIP-65/66, streaming store, partial publishes, cache
  - #21: the store lists everything
  - #23: Blossom uploads (D-033)
  - #26: social actions (D-035)
- After `config`, the remaining capabilities are `mesh`, `fs`, `cvm`, `webrtc` and `gamepad`.
