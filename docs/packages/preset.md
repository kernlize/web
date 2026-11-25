# @kernlize/preset

kernl's preset: the module list kernl.run runs over the kernel, and `createKernl`, which composes it when a host names no modules ([D-068](../decisions.md#d-068)). A host that wants kernl's own shell names the preset; a host that wants less names its own modules from `@kernlize/modules`. No package a host installs imports the preset (`pnpm check:deps` enforces this). The one exception is `@kernlize/core`, which re-exports it for the minor it is deprecated.

| Field | Value |
| --- | --- |
| npm | `@kernlize/preset` |
| JSR | `@kernl/preset` |
| Version | `0.1.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | `@kernlize/kernel`, `@kernlize/modules`, `@kernlize/bridges`, `@kernlize/messaging` (`workspace:^`) |
| Peer dependencies | `@napplet/nap` |
| Side effects | none |

## Install

This package is `@kernlize/preset` on npm and `@kernl/preset` on JSR, the same code at the same version.

```sh
npm install @kernlize/kernel @kernlize/preset
# or
deno add jsr:@kernl/kernel jsr:@kernl/preset
```

## Compose kernl's own shell

```ts
import type { KernlHost } from '@kernlize/kernel';
import { createKernl, kernlPreset } from '@kernlize/preset';

declare const host: KernlHost;
const kernl = createKernl({ host, modules: kernlPreset() });
kernl.messaging.list().map((entry) => entry.provider.id); // ['private', 'legacy', 'ratchet', 'group']
```

`kernlPreset(options)` names kernl.run's eighteen modules (including stacks and controller input) in setup order and hands each one its options. `createKernl({ host })` with no `modules` composes the same list from the options it is given.

[API reference](../api/modules/_kernlize_preset.html){target="_self"}
