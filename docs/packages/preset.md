# @kernlize/preset

kernl's preset: the module list kernl.run runs over the kernel, `createKernl`, which composes it when a host names no modules, and `previewPreset`, the same shell over parts that live in the page ([D-068](../decisions.md#d-068)). A host that wants kernl's own shell names the preset; a host that wants less names its own modules from `@kernlize/modules`. No package a host installs imports the preset (`pnpm check:deps` enforces this). The one exception is `@kernlize/core`, which re-exports it for the minor it is deprecated.

| Field | Value |
| --- | --- |
| npm | `@kernlize/preset` |
| JSR | `@kernl/preset` |
| Version | `0.2.1` |
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

## Relays that live in the page

`createMemoryRelays()` gives the real `RelayPool` a WebSocket that never leaves memory, so kernl's preview can run the kernel with no network. The relays answer as NIP-01 relays do, from one store that every URL shares.

```ts
import { RelayPool } from 'applesauce-relay';
import { createMemoryRelays } from '@kernlize/preset';

const relays = createMemoryRelays({ refusing: ['wss://refuse.example'] });
const pool = new RelayPool({ WebSocket: relays.WebSocket });
```

## The preview

`previewPreset(options)` runs the real kernel and kernl's own modules with no network. You pass it the signed samples you ship, and it returns the parts. `options(host)` gives `createKernl` everything it takes: the host with its `fetchBlob` replaced, the pool, a no-op artifact cache, and the modules.

```ts
import type { KernlHost } from '@kernlize/kernel';
import { createKernl, previewPreset, shippedSamples, type ShippedSamples } from '@kernlize/preset';

declare const host: KernlHost;
declare const listing: ShippedSamples;
declare function loadFile(file: string): Promise<string>;

const preview = previewPreset(shippedSamples(listing, loadFile));
const kernl = createKernl(preview.options(host));
await kernl.catalog.load(); // the samples, from their publisher
```

| Part | In memory | Instead of |
| --- | --- | --- |
| `pool` | applesauce's `RelayPool` over `createMemoryRelays()` | Relays on the network |
| Seeded events | Each sample's signed manifest, the publisher's profile and Ada's and Grace's profiles | Published events |
| `fetchBlob` | Each sample's bytes, found by the hash its manifest names. The kernel verifies them, so tampered bytes are refused | Blob servers |
| `artifactCache` | None | Cache Storage |
| Messages | `private` and `legacy` over memory backends. Ada and Grace have already written, and each send is answered after 900 ms. `ratchet` and `group` run their real backends over the page's relays | The identity's relays |
| Downloads | A `fetch` that answers each program's check, version `preview`, and refuses everything else | The person's programs |
| Bridges, tool search | Web pages, Blossom blobs and tool searches are refused as `unavailable:preview`. Magnet links go to the host's `openLink`, or to the `torrent` engine it passes | The web |

The preview leaves out the keys module, so it offers no keyboard shortcuts ([D-054](../decisions.md#d-054)). It also offers no `upload` domain, since every file server is on the network, and no `webrtc` domain, since a peer connection reaches STUN and TURN servers. Messages need a signed-in identity that can encrypt, such as `createThrowawayIdentity()`.

[API reference](../api/modules/_kernlize_preset.html){target="_self"}
