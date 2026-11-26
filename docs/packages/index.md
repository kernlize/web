# Packages

kernl has eight packages. Each has two names: `@kernlize/*` on npm and `@kernl/*` on JSR, for the same code at the same version. Three are pure contracts and engines with zero framework dependencies; the kernel composes them with kehto and applesauce; the modules are kernl's opinions over the kernel; the preset is kernl's own list of them; core, deprecated, re-exports those three; and one holds framework-free view models for a shell's panels over it. The shell app at `apps/web` is not published.

| npm | Version | JSR | Role | Dependencies | Peer dependencies |
| --- | --- | --- | --- | --- | --- |
| [`@kernlize/guard`](./guard.md) | `0.3.1` | `@kernl/guard` | Ingress flood control, visibility gate, focus-aware rate limiter, CSP profile, nested-frame lock, mitigation descriptions. | `@kehto/rate-limit` | `@napplet/core` |
| [`@kernlize/messaging`](./messaging.md) | `0.4.1` | `@kernl/messaging` | Messaging provider contract, registry, composite direct-message adapter, in-memory backend. | none | `@napplet/core` (the `Dm*` wire types) |
| [`@kernlize/bridges`](./bridges.md) | `0.3.0` | `@kernl/bridges` | Locator parsing, bridge contract, registry, HTTP bridge with SSRF policy. | none | none |
| [`@kernlize/kernel`](./kernel.md) | `0.1.2` | `@kernl/kernel` | The floor: applet resolve, plan and mount, the guard pipeline, the firewall, grants, signing consent, secrets, the media player, the module host and the ask channel (D-068). | the three above, `@kehto/*`, `applesauce-*`, `rxjs` | `@napplet/core`, `@napplet/nap` |
| [`@kernlize/modules`](./modules.md) | `0.2.0` | `@kernl/modules` | kernl's modules over the kernel: messaging, bridges, downloads, uploads, the catalog, intents, multiplayer, people, mailboxes, the relay directory, the event cache, the theme, settings, social, keys, the window manager (D-068). | `@kernlize/kernel`, the three leaf packages, `@kehto/*`, `applesauce-*`, `rxjs` | `@napplet/core`, `@napplet/nap`, `@napplet/shim`, `nostr-tools` |
| [`@kernlize/preset`](./preset.md) | `0.2.1` | `@kernl/preset` | `kernlPreset`, kernl.run's module list, and `createKernl` over the kernel and the modules (D-068). | `@kernlize/kernel`, `@kernlize/modules`, `@kernlize/bridges`, `@kernlize/messaging` | `@napplet/nap` |
| [`@kernlize/core`](./core.md) | `0.30.2` | `@kernl/core` | **Deprecated.** Re-exports `@kernlize/kernel`, `@kernlize/modules` and `@kernlize/preset` for one minor, then goes (D-068). | `@kernlize/kernel`, `@kernlize/modules`, `@kernlize/preset`, `@kernlize/bridges`, `@kernlize/messaging` | `@napplet/core`, `@napplet/nap`, `@napplet/shim`, `nostr-tools` |
| [`@kernlize/ui-model`](./ui-model.md) | `0.2.4` | `@kernl/ui-model` | Framework-free view models for a shell's panels: the grants list, the ask queues and the logs (#74). | `@kernlize/kernel`, `@kernlize/guard`, `@kernlize/messaging` | none |

## Shared rules

- ESM only, TypeScript strict, `verbatimModuleSyntax`. Each package ships `dist/index.js` and `dist/index.d.ts` with `sideEffects: false`.
- Every public export has JSDoc with `@param`, `@returns` and `@example`, and appears in the [API reference](../reference/api.md).
- Streams in `@kernlize/core` are rxjs `Observable`s (`session$`, `guard.events$`, `grants.changes$`, `relays.changes$`, `AppletHandle.status$`); unsubscribe the `Subscription` they return. `MessagingBackend.subscribe` returns `{ subscriptionId }`, which you pass to `unsubscribe`. Thrown errors carry a stable prefixed reason: `denied:`, `invalid:`, `unavailable:`; the full list is in [Error reasons](../reference/errors.md).
- No published package imports `nostr-tools` directly, and no published package depends on a UI framework. `pnpm check:deps` enforces both.
- Behaviour is specified in Gherkin under each package's `features/` and run by vitest with 100% coverage over `src`.

## Versioning

All packages are `0.x`. A breaking change is a `minor` bump; everything else is a `patch`. Releases are managed with changesets: one changeset per package whose shipped output changed. `@kernlize/kernel` depends on the three leaf packages, `@kernlize/modules` on those and the kernel, and `@kernlize/core` on the kernel and the modules, all with `workspace:^`, so a release of a package produces a patch of each above it.

## Install

Every package has an npm name and a JSR name. The code, the exports and the version are the same under both.

| Directory | npm | JSR |
| --- | --- | --- |
| `packages/guard` | `@kernlize/guard` | `@kernl/guard` |
| `packages/messaging` | `@kernlize/messaging` | `@kernl/messaging` |
| `packages/bridges` | `@kernlize/bridges` | `@kernl/bridges` |
| `packages/kernel` | `@kernlize/kernel` | `@kernl/kernel` |
| `packages/modules` | `@kernlize/modules` | `@kernl/modules` |
| `packages/preset` | `@kernlize/preset` | `@kernl/preset` |
| `packages/core` | `@kernlize/core` | `@kernl/core` |
| `packages/ui-model` | `@kernlize/ui-model` | `@kernl/ui-model` |

Install from either registry:

```sh
npm install @kernlize/kernel @kernlize/modules
# or, with Deno or any JSR client
deno add jsr:@kernl/kernel jsr:@kernl/modules
```

Import by the name of the registry you installed from. The examples in these docs use the npm names; with JSR, write `@kernl/` where they write `@kernlize/`. That holds for subpaths too: `@kernlize/modules/messaging` on npm is `@kernl/modules/messaging` on JSR. npm ships JavaScript and declarations; JSR ships the TypeScript source. [Publish packages](../how-tos/publish-packages.md) covers release setup.

A host on the kernel installs `@kernlize/kernel` and `@kernlize/modules` and imports the modules it wants from their own entries ([Build a shell with your own UX](../tutorials/build-a-shell.md)). A host that wants kernl.run's whole shell installs `@kernlize/preset` too and calls `createKernl`. `@kernlize/core` still re-exports all three for one minor; move to them.

To work on the packages themselves, clone the repository and run `pnpm install && pnpm build`, which writes each package's `dist/`; a workspace package depends on them with `workspace:^`, as `apps/web` does.

Install a leaf package alone when you want its contract without kehto and applesauce, for example `@kernlize/guard` to test an applet against the limits, or `@kernlize/messaging` to write a provider.
