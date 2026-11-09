# Packages

kernl has four packages. Each has two names: `@kernlize/*` on npm and `@kernl/*` on JSR, for the same code at the same version. Neither registry has a release yet (see [Install](#install)). Three are pure contracts and engines with zero framework dependencies; one composes them with kehto and applesauce. The shell app at `apps/web` is not published.

| npm | Version | JSR | Role | Dependencies | Peer dependencies |
| --- | --- | --- | --- | --- | --- |
| [`@kernlize/guard`](./guard.md) | `0.1.1` | `@kernl/guard` | Ingress flood control, visibility gate, focus-aware firewall, CSP profile, nested-frame lock, mitigation descriptions. | `@kehto/firewall` | `@napplet/core` |
| [`@kernlize/messaging`](./messaging.md) | `0.3.0` | `@kernl/messaging` | Messaging provider contract, registry, composite direct-message adapter, in-memory backend. | none | `@napplet/core` (the `Dm*` wire types) |
| [`@kernlize/bridges`](./bridges.md) | `0.2.1` | `@kernl/bridges` | Locator parsing, bridge contract, registry, HTTP bridge with SSRF policy. | none | none |
| [`@kernlize/core`](./core.md) | `0.5.0` | `@kernl/core` | Composition root over kehto and applesauce: adapters, applet resolution, mount plan, consent summaries, layouts, persistence. | the three above, `@kehto/*`, `applesauce-*`, `rxjs` | `@napplet/core`, `@napplet/nap`, `@napplet/shim`, `nostr-tools` (required by kehto and applesauce; never imported) |

## Shared rules

- ESM only, TypeScript strict, `verbatimModuleSyntax`. Each package ships `dist/index.js` and `dist/index.d.ts` with `sideEffects: false`.
- Every public export has JSDoc with `@param`, `@returns` and `@example`, and appears in the [API reference](../reference/api.md).
- Streams in `@kernlize/core` are rxjs `Observable`s (`session$`, `guard.events$`, `grants.changes$`, `relays.changes$`, `AppletHandle.status$`); unsubscribe the `Subscription` they return. `MessagingBackend.subscribe` returns `{ subscriptionId }`, which you pass to `unsubscribe`. Thrown errors carry a stable prefixed reason: `denied:`, `invalid:`, `unavailable:`; the full list is in [Error reasons](../reference/errors.md).
- No published package imports `nostr-tools` directly, and no published package depends on a UI framework. `pnpm check:deps` enforces both.
- Behaviour is specified in Gherkin under each package's `features/` and run by vitest with 100% coverage over `src`.

## Versioning

All packages are `0.x`. A breaking change is a `minor` bump; everything else is a `patch`. Releases are managed with changesets: one changeset per package whose shipped output changed. `@kernlize/core` depends on the other three with `workspace:^`, so a release of a leaf package produces a patch of core.

## Install

Every package has an npm name and a JSR name. The code, the exports and the version are the same under both.

| Directory | npm | JSR |
| --- | --- | --- |
| `packages/guard` | `@kernlize/guard` | `@kernl/guard` |
| `packages/messaging` | `@kernlize/messaging` | `@kernl/messaging` |
| `packages/bridges` | `@kernlize/bridges` | `@kernl/bridges` |
| `packages/core` | `@kernlize/core` | `@kernl/core` |

After the first release, install from either registry:

```sh
npm install @kernlize/core
# or, with Deno or any JSR client
deno add jsr:@kernl/core
```

Import by the name of the registry you installed from. The examples in these docs use the npm names; with JSR, write `@kernl/` where they write `@kernlize/`. That holds for subpaths too: `@kernlize/core/wm` on npm is `@kernl/core/wm` on JSR. npm ships JavaScript and declarations; JSR ships the TypeScript source. [Publish packages](../how-tos/publish-packages.md) covers release setup.

Neither registry has a release yet: `npm install @kernlize/core` and `deno add jsr:@kernl/core` both fail with a not-found error. During the alpha the source repository is private, and the packages are used from a clone of it:

```bash
# in a clone of the kernl source repository
pnpm install && pnpm build
```

`pnpm build` writes each package's `dist/`, which is what `main`, `types` and `exports` point at. Then add your code as a workspace package (under `packages/` or `apps/`, the globs in `pnpm-workspace.yaml`) and depend on what you need with the workspace protocol, as `apps/web` does:

```json
{
  "dependencies": {
    "@kernlize/core": "workspace:^",
    "@kernlize/guard": "workspace:^"
  }
}
```

Run `pnpm install` again after editing the manifest so pnpm links the workspace packages. `@kernlize/core` pulls the other three in. Install a leaf package alone when you want its contract without kehto and applesauce, for example `@kernlize/guard` to test an applet against the limits, or `@kernlize/messaging` to write a provider.
