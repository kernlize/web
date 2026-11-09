# Packages

kernl has four packages under the npm `@kernlize` scope and the JSR `@kernl` scope, not yet published to npm (see [Install](#install)). Three are pure contracts and engines with zero framework dependencies; one composes them with kehto and applesauce. The shell app at `apps/web` is not published.

| Package | Version | Role | Dependencies | Peer dependencies |
| --- | --- | --- | --- | --- |
| [`@kernlize/guard`](./guard.md) | `0.1.0` | Ingress flood control, visibility gate, focus-aware firewall, CSP profile, nested-frame lock, mitigation descriptions. | `@kehto/firewall` | `@napplet/core` |
| [`@kernlize/messaging`](./messaging.md) | `0.2.0` | Messaging provider contract, registry, composite direct-message adapter, in-memory backend. | none | `@napplet/core` (the `Dm*` wire types) |
| [`@kernlize/bridges`](./bridges.md) | `0.2.0` | Locator parsing, bridge contract, registry, HTTP bridge with SSRF policy. | none | none |
| [`@kernlize/core`](./core.md) | `0.2.0` | Composition root over kehto and applesauce: adapters, applet resolution, mount plan, consent summaries, layouts, persistence. | the three above, `@kehto/*`, `applesauce-*`, `rxjs` | `@napplet/core`, `@napplet/nap`, `@napplet/shim`, `nostr-tools` (required by kehto and applesauce; never imported) |

## Shared rules

- ESM only, TypeScript strict, `verbatimModuleSyntax`. Each package ships `dist/index.js` and `dist/index.d.ts` with `sideEffects: false`.
- Every public export has JSDoc with `@param`, `@returns` and `@example`, and appears in the [API reference](../reference/api.md).
- Streams in `@kernlize/core` are rxjs `Observable`s (`session$`, `guard.events$`, `grants.changes$`, `relays.changes$`, `AppletHandle.status$`); unsubscribe the `Subscription` they return. `MessagingBackend.subscribe` returns `{ subscriptionId }`, which you pass to `unsubscribe`. Thrown errors carry a stable prefixed reason: `denied:`, `invalid:`, `unavailable:`; the full list is in [Error reasons](../reference/errors.md).
- No published package imports `nostr-tools` directly, and no published package depends on a UI framework. `pnpm check:deps` enforces both.
- Behaviour is specified in Gherkin under each package's `features/` and run by vitest with 100% coverage over `src`.

## Versioning

All packages are `0.x`. A breaking change is a `minor` bump; everything else is a `patch`. Releases are managed with changesets: one changeset per package whose shipped output changed. `@kernlize/core` depends on the other three with `workspace:^`, so a release of a leaf package produces a patch of core.

## Install

After the first release, install from either registry:

```sh
npm install @kernlize/core
# or, with Deno
deno add jsr:@kernl/core
```

The leaf packages follow the same mapping: npm `@kernlize/{guard,messaging,bridges}`, JSR `@kernl/{guard,messaging,bridges}`. Both registries use the same package versions. JSR ships TypeScript source; npm ships JavaScript and declarations. The examples in these docs use npm imports. See [Publish packages](../how-tos/publish-packages.md) for release setup and validation.


The `@kernlize/*` packages are not yet published to npm; `pnpm add @kernlize/core` fails with a not-found error. During the alpha the source repository is private, and the packages are used from a clone of it:

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
