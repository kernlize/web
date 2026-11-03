# Add a bridge backend

The four non-HTTP bridges ship as parsers plus a backend interface. Supplying a backend turns `unavailable` into a working bridge without touching the parser, the registry or the consent path, all of which the HTTP bridge already exercises. This how-to supplies a `TorrentBackend`; the others follow the same shape.

## 1. Pick the interface

| Bridge | Interface | Method |
| --- | --- | --- |
| `torrent` | `TorrentBackend` | `add(infoHash, trackers, context) → Promise<{ id, name }>` |
| `nzb` | `NzbBackend` | `add(url, context) → Promise<{ id, name }>` |
| `soulseek` | `SoulseekBackend` | `download(user, path, context) → Promise<{ id, name }>` |
| `mail` | `MailBackend` | `open(address, subject, context) → Promise<{ id }>` |

`context` is the `BridgeContext` the registry passes through: the requester identity (or `'shell'`), an `AbortSignal` and optional headers. Honour the signal.

## 2. Implement it outside the published packages

A backend talks to something: a WebTorrent client, a downloader daemon, a mail account. That belongs in `apps/web` (or in a package of its own with its own dependencies), not in `@kernl/bridges`, which stays dependency-free.

```ts
import type { BridgeContext, TorrentBackend } from '@kernl/bridges';

export function createWebTorrentBackend(client: WebTorrentLike): TorrentBackend {
  return {
    async add(infoHash, trackers, context: BridgeContext) {
      const torrent = client.add(`magnet:?xt=urn:btih:${infoHash}${trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('')}`);
      context.signal?.addEventListener('abort', () => client.remove(torrent), { once: true });
      await torrent.ready;
      return { id: torrent.infoHash, name: torrent.name };
    },
  };
}
```

Return a stable `id`: the shell uses it to show job state and to let the user cancel.

## 3. Hand it to the bridge

`createTorrentBridge(backend?)` in `@kernl/bridges` takes the backend as an optional argument. Without one it reports `unavailable:no-backend`; with one it reports available and routes `resolve()` to `backend.add`. In `createKernl`, replace the bare registration:

```ts
registry.register(createTorrentBridge(createWebTorrentBackend(client)));
```

Check the bridge's `exposure`. A WebTorrent backend reveals the user's address to the swarm and makes activity public; the bridge already declares `revealsAddress: true` and `publicActivity: true`. If your backend changes the truth of any field (for example a backend that tunnels through a seedbox does not reveal the user's address), construct the bridge with a corrected exposure. The user reads these three booleans before consenting; they must be right.

## 4. Consent and quota are already there

You do not add a prompt. `BridgeRegistry.resolve` calls the shell's `BridgeAuthorizer` before any bridge runs, and the guard's `resource:bytes` bucket and hidden-window allowance apply before the registry is reached. A job result shows up in the shell's downloads list with the bridge's label.

## 5. Specify and document

- Add scenarios under `packages/bridges/features/` for: the bridge reports available with a backend and `unavailable:no-backend` without; `resolve` passes `infoHash` and `trackers` from the locator's fields; an aborted context aborts the backend.
- Move the backend's row from "unavailable" to "available" in [Bridges](../concepts/bridges.md#backend-interfaces) and strike it from the [Roadmap](../roadmap.md).
- Add a changeset.

The slop gate and the coverage threshold apply to the backend if it lives in `packages/`. If it lives in `apps/web`, the Playwright suite in `pnpm test:e2e` covers it.
