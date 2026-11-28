# @kernlize/kernel

kernl's floor: what every kernl shell runs, whatever modules it names. It holds the applesauce trio (one `EventStore`, one `RelayPool`, one `AccountManager`), the relay tiers, the guard pipeline, the firewall, grants, signing consent, secrets and the media player ([D-063](../decisions.md#d-063)). It also holds applet resolve, plan and mount, the module host and the ask channel ([D-067](../decisions.md#d-067)). Every opinion is a module a host names ([D-068](../decisions.md#d-068)). The kernel imports none of them, and `pnpm check:deps` enforces that.

| Field | Value |
| --- | --- |
| npm | `@kernlize/kernel` |
| JSR | `@kernl/kernel` |
| Version | `0.3.0` |
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

With the cache module and an event cache opener, the kernel replays [shared public tree observations](../concepts/persistence.md#outbox-replay) after an Outbox read is approved. `outbox.subscribe` delivers cached events before opening the approved relays. `outbox.query` merges cached matches with the relay results. The kernel waits up to 250 ms for persistent cache reads. No applet changes or additional grants are needed. Without an opener the Outbox service uses the relay router directly.

| Host hook or type | Contract |
| --- | --- |
| `KernlHost.outboxCache` | Optional asynchronous `OutboxCacheBacking`. Keep observations isolated to the current tab's namespace if they survive reloads. |
| `OutboxCacheBacking` | `visit(visitor)` delivers records newest by creation time, then ascending by event ID, stopping when the visitor returns `false`. `observe(event, relay)` upserts a live observation. `close()` releases the backing without clearing it. |
| `OutboxCacheRecord` | A signed `event` and its observed `relays`. The kernel checks the signature, filters and relay plan before replay. |
| `KernlHost.outboxCacheStorage` | Legacy tab-scoped `StorageLike` fallback when no asynchronous backing is supplied. Keeps the previous small size and count limits, with no age expiry. Without either hook, the cache lives only in page memory. |

## Reviewed grants and intent focus

`withGrantReview(summary, open)` keeps temporary grants in force while a verified applet is being replaced. The callback can reuse a mounted plan with matching startup domains, or plan and mount a replacement before returning. The module host’s `focusChanges$` reports window focus after the guard records it. A host receives the optional focus choice when opening an applet for an intent; `focus: false` keeps the current window in front.

## Light entries

These entries load without the network stack.

- `@kernlize/kernel/crypto`: the Web Crypto fallback, for pages outside a secure context ([D-024](../decisions.md#d-024)).
- `@kernlize/kernel/seal`: the message seal ([D-046](../decisions.md#d-046)).
- `@kernlize/kernel/asks`: the ask kinds and the ask channel, for a UI's ask queues.

`@kernlize/core/crypto`, `@kernlize/core/seal` and `@kernlize/core/asks` re-export them.

[API reference](../api/modules/_kernlize_kernel.html){target="_self"}
