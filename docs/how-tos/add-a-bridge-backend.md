# Add a bridge backend

The four non-HTTP bridges are complete up to the backend interface they call. In the composed shell each already has a backend: the hand-off backend from `createHandoffBackends`, which opens the locator in an app on the user's device and moves no data through kernl ([Bridges](../concepts/bridges.md#hand-off-backends)). Hand-off is the default for NZB, Soulseek and mail. The torrent bridge already has an in-shell backend, `createWebTorrentBackend`, which the web shell passes as `KernlOptions.torrent` ([Downloads inside kernl](../concepts/bridges.md#downloads-inside-kernl)). Another backend replaces the hand-off (or the in-page one) for its bridge, without touching the parser or the registry, both of which the HTTP bridge already exercises. This how-to supplies a `TorrentBackend` that sends links to a seedbox the user runs; the others follow the same shape. NZB, Soulseek and mail cannot be served from inside a page at all, because their protocols need raw TCP sockets; their backends will talk to a companion service ([Roadmap](../roadmap.md#_2-bridge-backends)).

## 1. Pick the interface

| Bridge | Label | Interface | Method | Locator fields used |
| --- | --- | --- | --- | --- |
| `torrent` | `downloads` | `TorrentBackend` | `add(infoHash, trackers, context, name?) → Promise<{ id, name }>` | `infoHash`, `trackers` (may be empty), `name` (`undefined` when absent) |
| `nzb` | `downloads` | `NzbBackend` | `add(url, context) → Promise<{ id, name }>` | `url` |
| `soulseek` | `sharing` | `SoulseekBackend` | `download(user, path, context) → Promise<{ id, name }>` | `user`, `path` |
| `mail` | `mail` | `MailBackend` | `open(address, subject, context, body?) → Promise<{ id }>` | `address`, `subject` and `body` (`undefined` when absent) |

`context` is the `BridgeContext` the registry passes through: the requester identity (or `'shell'`), an optional `AbortSignal` and optional headers. Honour the signal when it is present. The bridge reads the fields before calling you and rejects with `invalid:locator-missing-<field>` if one is missing, so inside the backend they are guaranteed strings; `trackers` is always a list. Leave `handoff` unset: it is the trait that tells the user the bridge opens an app on the device, and an in-shell backend does not.

## 2. Implement it outside the published packages

A backend talks to something: a seedbox's web API, a downloader daemon, a mail account. That belongs in the host app (`apps/web`, or your own page) or in a package of its own with its own dependencies, not in `@kernlize/bridges`, which stays dependency-free. The samples on this page are one module, read top to bottom, and are type-checked by `node scripts/check-doc-samples.mjs` as part of `pnpm docs:check`.

```ts
import type { BridgeContext, TorrentBackend } from '@kernlize/bridges';

interface SeedboxLike {
  add(magnet: string): { infoHash: string; name: string; ready: Promise<void> };
  remove(torrent: { infoHash: string }): void;
}

export function createSeedboxBackend(client: SeedboxLike): TorrentBackend {
  return {
    async add(infoHash, trackers, context: BridgeContext) {
      const magnet = `magnet:?xt=urn:btih:${infoHash}${trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('')}`;
      const torrent = client.add(magnet);
      context.signal?.addEventListener('abort', () => client.remove(torrent), { once: true });
      await torrent.ready;
      return { id: torrent.infoHash, name: torrent.name };
    },
  };
}
```

Return a stable `id`: it is the job's identity in the `202` body the applet receives, and what a downloads view uses to show state and cancel. The `name` becomes the job's `label`. Reject with stable reasons (`unavailable:engine-offline`, `denied:…`); the registry reports and rethrows them unchanged (`registry.feature`, scenario "a bridge failure is reported and rethrown").

## 3. Hand it to the bridge

`createTorrentBridge(backend?)` takes the backend as an optional argument. Without one it reports `{ available: false, reason: 'no-backend' }` and rejects every `resolve()` with `unavailable:no-backend`; with a hand-off backend it reports `{ available: true, handoff: true }`; with yours it reports `{ available: true }` and routes `resolve()` to `backend.add`.

The shell's bridges are registered by `createDefaultBridges` in `packages/core/src/bridges/default-registry.ts`, which `createKernl` calls when `KernlOptions.bridges` is absent. Its options are the registry's `authorize` and `onResolve`, `http` for the web bridge, an optional `handoff` opener and an optional `torrent` backend; `createKernl` passes `host.openLink` as that opener and `KernlOptions.torrent` as the torrent backend. For a torrent backend whose exposure matches the stock bridge, that is all it takes:

<!-- sample:continues -->
```ts
import { createKernl, type KernlHost } from '@kernlize/core';

declare const host: KernlHost;
declare const client: SeedboxLike;

createKernl({ host, torrent: createSeedboxBackend(client) }).bridges.forScheme('magnet')?.availability(); // { available: true }
```

`createDefaultBridges` takes no other backends, and a registry cannot replace a bridge it already holds (a second `torrent` throws `invalid:duplicate-bridge torrent`). So a host that supplies a backend for another bridge, or a bridge with a different exposure, builds the same five registrations itself, with its backend in place and hand-off backends for the rest, and passes the registry as `KernlOptions.bridges`:

<!-- sample:continues -->
```ts
import {
  createBridgeRegistry,
  createHandoffBackends,
  createHttpBridge,
  createMailBridge,
  createNzbBridge,
  createSoulseekBridge,
  createTorrentBridge,
  type BridgeRegistry,
  type HandoffOpener,
} from '@kernlize/bridges';

export function createBridgesWithTorrent(torrent: TorrentBackend, open: HandoffOpener): BridgeRegistry {
  const handoff = createHandoffBackends(open);
  const registry = createBridgeRegistry({ onResolve: (event) => console.info('bridge', event) });
  registry.register(createHttpBridge());
  registry.register(createTorrentBridge(torrent));
  registry.register(createNzbBridge(handoff.nzb));
  registry.register(createSoulseekBridge(handoff.soulseek));
  registry.register(createMailBridge(handoff.mail));
  return registry;
}

const kernl = createKernl({ host, bridges: createBridgesWithTorrent(createSeedboxBackend(client), (uri) => host.openLink(uri)) });
kernl.bridges.forScheme('magnet')?.availability(); // { available: true }
```

The web, NZB, Soulseek and mail bridges are the same as the defaults: the web bridge as before, the other three handing off through the host's confirm-before-leaving opener. To ship a backend for another bridge inside kernl itself, add an option to `createDefaultBridges` the way `torrent` was added ([D-017](../decisions.md#d-017)).

Check the bridge's `exposure`. The torrent bridge declares `revealsAddress: true`, `encryptedInTransit: false`, `publicActivity: true`, which is the truth for a client in a public swarm. The factory does not take an exposure argument, so if your backend changes the truth of any field (a backend that tunnels through a seedbox does not reveal the user's address), register a bridge object with the same `resolve` and a corrected `exposure`:

<!-- sample:continues -->
```ts
import type { Bridge } from '@kernlize/bridges';

export function createTunnelledTorrentBridge(torrent: TorrentBackend): Bridge {
  const stock = createTorrentBridge(torrent);
  return { ...stock, exposure: { ...stock.exposure, revealsAddress: false } };
}
```

In `createBridgesWithTorrent`, register `createTunnelledTorrentBridge(torrent)` in place of `createTorrentBridge(torrent)`.

These three booleans are what the user reads about the bridge: `describeBridge` renders them in the shell's settings. There is no per-request bridge prompt in this draft, so the description is the only place the user learns what a transfer exposes; it must be right.

## 4. What already applies, and what does not yet

`BridgeRegistry.resolve` checks `availability()`, then calls the registry's `authorize` hook if one was given, before any bridge runs; a denial rejects with `denied:bridge`. The composed shell wires no `BridgeAuthorizer`: `createKernl` uses `createDefaultBridges({ handoff: (uri) => host.openLink(uri), torrent })` without `authorize`, so a request from an applet that holds the `resource` grant reaches your bridge without a per-request prompt. A host that wants one passes `authorize` to `createBridgeRegistry` in the sample above; a consent prompt per host in the shell is on the [Roadmap](../roadmap.md#_6-guard) ([Alpha status](../alpha-status.md#what-does-not-work-yet)).

The guard's `resource:bytes` rate and hidden-window allowance apply to `resource.*` envelopes. A `job` result reaches kehto's resource service as a `202 Accepted` JSON body through `createBridgeResourceResolver`; the applet that asked receives it. The shell's Downloads panel shows the jobs of its own in-page backend, through `WebTorrentBackend.jobs()` and `subscribe`; a backend of yours shows state to the user only if the host gives it a view. Every outcome is also reported to the registry's `onResolve` as a `BridgeResolveEvent`, when your registry passes one, as the sample does; the shell's default registry passes none, and no outcome reaches the guard panel.

## 5. Specify and document

- `packages/bridges/features/backend-bridges.feature` already covers the contract with a fake backend: unavailable without a backend, fields handed through, missing fields rejected. Add scenarios for what your backend adds: an aborted context cancels the job; the engine's failure reasons surface unchanged.
- Say in [Bridges](../concepts/bridges.md#downloads-inside-kernl) that the bridge now has an in-shell backend, and what it changes for the user, and strike it from the [Roadmap](../roadmap.md#_2-bridge-backends).
- Add a changeset.

The slop gate and the coverage threshold apply to the backend if it lives in `packages/`. If it lives in `apps/web`, the Playwright suite in `pnpm test:e2e` covers it.
