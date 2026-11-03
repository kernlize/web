# Packages

kernl publishes four packages under the `@kernl` scope. Three are pure contracts and engines with zero framework dependencies; one composes them with kehto and applesauce. The shell app at `apps/web` is not published.

| Package | Version | Role | Depends on |
| --- | --- | --- | --- |
| [`@kernl/guard`](./guard.md) | `0.1.0` | Ingress flood control, visibility gate, focus-aware firewall, CSP profile, mitigation descriptions. | `@kehto/firewall` |
| [`@kernl/messaging`](./messaging.md) | `0.1.0` | Messaging provider contract, registry, composite direct-message adapter. | `@napplet/core` (types, peer) |
| [`@kernl/bridges`](./bridges.md) | `0.1.0` | Locator parsing, bridge contract, registry, HTTP bridge with SSRF policy. | nothing |
| [`@kernl/core`](./core.md) | `0.1.0` | Composition root over kehto and applesauce: adapters, applet resolution, mount plan, consent summaries, layouts, persistence. | the three above, `@kehto/*`, `applesauce-*`, `rxjs` |

## Shared rules

- ESM only, TypeScript strict, `verbatimModuleSyntax`. Each package ships `dist/index.js` and `dist/index.d.ts` with `sideEffects: false`.
- Every public export has JSDoc with `@param`, `@returns` and `@example`, and appears in the [API reference](../reference/api.md).
- Subscriptions return `{ close() }`. Errors carry a stable prefixed reason: `denied:`, `invalid:`, `unavailable:`.
- No published package imports `nostr-tools` directly, and no published package depends on a UI framework. `pnpm check:deps` enforces both.
- Behaviour is specified in Gherkin under each package's `features/` and run by vitest with 100% coverage over `src`.

## Versioning

All packages are `0.x`. A breaking change is a `minor` bump; everything else is a `patch`. Releases are managed with changesets: one changeset per package whose shipped output changed. `@kernl/core` depends on the other three with `workspace:^`, so a release of a leaf package produces a patch of core.

## Install

```bash
pnpm add @kernl/core
# or individually
pnpm add @kernl/guard @kernl/messaging @kernl/bridges
```

`@kernl/core` pulls the other three in. Install a leaf package alone when you want its contract without kehto and applesauce, for example `@kernl/guard` to test an applet against the limits, or `@kernl/messaging` to write a provider.
