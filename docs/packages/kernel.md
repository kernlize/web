# @kernlize/kernel

kernl's floor: what every kernl shell runs, whatever modules it names. It holds the applesauce trio (one `EventStore`, one `RelayPool`, one `AccountManager`), the relay tiers, the guard pipeline, the firewall, grants, signing consent, secrets and the media player ([D-063](../decisions.md#d-063)). It also holds applet resolve, plan and mount, the module host and the ask channel ([D-067](../decisions.md#d-067)). Every opinion is a module a host names ([D-068](../decisions.md#d-068)). The kernel imports none of them, and `pnpm check:deps` enforces that.

| Field | Value |
| --- | --- |
| npm | `@kernlize/kernel` |
| JSR | `@kernl/kernel` |
| Version | `0.1.2` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts`; also `./crypto`, `./seal` and `./asks` |
| Dependencies | `@kernlize/guard`, `@kernlize/messaging`, `@kernlize/bridges` (`workspace:^`), `@kehto/*`, `@noble/*`, `applesauce-*`, `rxjs` |
| Peer dependencies | `@napplet/core`, `@napplet/nap` |
| Side effects | none |

## Install

This package is `@kernlize/kernel` on npm and `@kernl/kernel` on JSR, the same code at the same version.

```sh
npm install @kernlize/kernel
# or
deno add jsr:@kernl/kernel
```

## Compose a shell from the kernel

`createKernel` composes the kernel with the modules a host lists and nothing else. Each module's api appears beside the kernel's members, typed by the list.

```ts
import { createKernel, type KernlHost, type KernlModule } from '@kernlize/kernel';

declare const host: KernlHost;
const clock: KernlModule<'clock', { now(): number }> = { id: 'clock', setup: () => ({ api: { now: () => Date.now() } }) };
const kernl = createKernel({ host, modules: [clock] });
kernl.clock.now();
```

kernl's own module list is `kernlPreset`, and `createKernl` from `@kernlize/core` composes it when a host names no modules.

## Outbox reads

With the cache module and an event cache opener, the kernel replays [shared public tree observations](../concepts/persistence.md#outbox-replay) after an Outbox read is approved. `outbox.subscribe` delivers cached events before opening the approved relays. `outbox.query` returns cached matches together with the relay results at the normal completion time. No applet changes or additional grants are needed. Hosts can supply `KernlHost.outboxCacheStorage` to retain observations across reloads in the same tab. This storage must not be shared across tabs; if omitted, observations live only in page memory. Without an opener the Outbox service uses the relay router directly.

## Reviewed grants and intent focus

`withGrantReview(summary, open)` keeps temporary grants in force while a verified applet is being replaced. The callback can reuse a mounted plan with matching startup domains, or plan and mount a replacement before returning. The module host’s `focusChanges$` reports window focus after the guard records it. A host receives the optional focus choice when opening an applet for an intent; `focus: false` keeps the current window in front.

## Light entries

These entries load without the network stack.

- `@kernlize/kernel/crypto`: the Web Crypto fallback, for pages outside a secure context ([D-024](../decisions.md#d-024)).
- `@kernlize/kernel/seal`: the message seal ([D-046](../decisions.md#d-046)).
- `@kernlize/kernel/asks`: the ask kinds and the ask channel, for a UI's ask queues.

`@kernlize/core/crypto`, `@kernlize/core/seal` and `@kernlize/core/asks` re-export them.

[API reference](../api/modules/_kernlize_kernel.html){target="_self"}
