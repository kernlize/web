# Add a bridge backend

The four non-HTTP bridges are complete up to the backend interface they call. Supplying a backend turns `unavailable` into a working bridge without touching the parser, the registry or the consent path, all of which the HTTP bridge already exercises. This how-to supplies a `TorrentBackend`; the others follow the same shape.

## 1. Pick the interface

| Bridge | Label | Interface | Method | Locator fields used |
| --- | --- | --- | --- | --- |
| `torrent` | `downloads` | `TorrentBackend` | `add(infoHash, trackers, context) → Promise<{ id, name }>` | `infoHash`, `trackers` (may be empty) |
| `nzb` | `downloads` | `NzbBackend` | `add(url, context) → Promise<{ id, name }>` | `url` |
| `soulseek` | `sharing` | `SoulseekBackend` | `download(user, path, context) → Promise<{ id, name }>` | `user`, `path` |
| `mail` | `mail` | `MailBackend` | `open(address, subject, context) → Promise<{ id }>` | `address`, `subject` (`undefined` when absent) |

`context` is the `BridgeContext` the registry passes through: the requester identity (or `'shell'`), an optional `AbortSignal` and optional headers. Honour the signal when it is present. The bridge reads the fields before calling you and rejects with `invalid:locator-missing-<field>` if one is missing, so inside the backend they are guaranteed strings; `trackers` is always a list.

## 2. Implement it outside the published packages

A backend talks to something: a WebTorrent client, a downloader daemon, a mail account. That belongs in `apps/web` (or in a package of its own with its own dependencies), not in `@kernl/bridges`, which stays dependency-free.

```ts
import type { BridgeContext, TorrentBackend } from '@kernl/bridges';

interface WebTorrentLike {
  add(magnet: string): { infoHash: string; name: string; ready: Promise<void> };
  remove(torrent: { infoHash: string }): void;
}

export function createWebTorrentBackend(client: WebTorrentLike): TorrentBackend {
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

Return a stable `id`: the shell uses it to show job state and to let the user cancel. The `name` becomes the job's `label`. Reject with stable reasons (`unavailable:engine-offline`, `denied:…`); the registry reports and rethrows them unchanged (`registry.feature`, scenario "a bridge failure is reported and rethrown").

## 3. Hand it to the bridge

`createTorrentBridge(backend?)` takes the backend as an optional argument. Without one it reports `{ available: false, reason: 'no-backend' }` and rejects every `resolve()` with `unavailable:no-backend`; with one it reports available and routes `resolve()` to `backend.add`. In `createKernl`, replace the bare registration:

```ts
import { createBridgeRegistry, createTorrentBridge, formatLocator } from '@kernl/bridges';

const registry = createBridgeRegistry({
  authorize: (locator, bridge) => confirm(`Open ${formatLocator(locator)} with ${bridge.label}?`),
  onResolve: (event) => log.push(event),
});
registry.register(createTorrentBridge(createWebTorrentBackend(client)));
```

Check the bridge's `exposure`. The torrent bridge declares `revealsAddress: true`, `encryptedInTransit: false`, `publicActivity: true`, which is the truth for a client in a public swarm. The factory does not take an exposure argument, so if your backend changes the truth of any field (a backend that tunnels through a seedbox does not reveal the user's address), register a bridge object with the same `resolve` and a corrected `exposure`:

```ts
const stock = createTorrentBridge(createWebTorrentBackend(client));
registry.register({ ...stock, exposure: { ...stock.exposure, revealsAddress: false } });
```

The user reads these three booleans, rendered by `describeBridge`, before consenting; they must be right.

## 4. Consent and quota are already there

You do not add a prompt. `BridgeRegistry.resolve` checks `availability()`, then calls the shell's `BridgeAuthorizer`, before any bridge runs; a denial rejects with `denied:bridge`. The guard's `resource:bytes` bucket and hidden-window allowance apply before the registry is reached. A `job` result reaches kehto's resource service as a `202 Accepted` JSON body through `createBridgeResourceResolver`, and shows up in the shell's downloads list with the bridge's label. Every outcome is also reported to `onResolve` as a `BridgeResolveEvent`.

## 5. Specify and document

- `packages/bridges/features/backend-bridges.feature` already covers the contract with a fake backend: unavailable without a backend, fields handed through, missing fields rejected. Add scenarios for what your backend adds: an aborted context cancels the job; the engine's failure reasons surface unchanged.
- Move the backend's row from "unavailable" to "available" in [Bridges](../concepts/bridges.md#backend-driven-bridges) and strike it from the [Roadmap](../roadmap.md).
- Add a changeset.

The slop gate and the coverage threshold apply to the backend if it lives in `packages/`. If it lives in `apps/web`, the Playwright suite in `pnpm test:e2e` covers it.
