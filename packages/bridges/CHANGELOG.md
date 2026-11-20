# @kernlize/bridges

## 0.3.0

### Minor Changes

- 9488528: Applets' `blossom:` resources load. `createBlossomBridge` and `parseBlossomReference` are new in `@kernlize/bridges`: the bridge reads BUD-10 references and the `blossom:sha256:<hash>` form, asks the reference's hints and then the requester's servers under the web policy, and returns only bytes whose hash matches. `createDefaultBridges` registers it, with `blossomServers` for each requester's servers, and `createKernl` passes the running applet's manifest servers. Resource failures now reach applets as their NAP-RESOURCE codes (`not-found`, `unsupported-scheme`, `blocked-by-policy`, …) through the new `resourceErrorFor`, instead of all as `network-error`.
- 06c02fc: Adapters that drive the download programs a person already runs, each through the program's own HTTP API: `createTransmissionClient` and `createUtorrentClient` (`TorrentClient`), `createNzbgetClient` and `createSabnzbdClient` (`NzbClient`), and `createSlskdClient` (`SoulseekClient`). Every method rejects with one of the `ClientFailure` reasons. `checkClientEndpoint`, `endpointCandidates` and `detectClientEndpoint` check a program's address against how the page was loaded and work out its scheme; `readTorrentMetainfo` and `magnetInfoHash` read a v1 info hash from a `.torrent` file or a magnet link.

## 0.2.1

### Patch Changes

- 5726a3d: Publish npm packages under `@kernlize/*` and the same releases on JSR under `@kernl/*`. Update internal imports and the exported `PACKAGE_NAME` constants to the npm names. Generate JSR sources and dependency maps from the workspace and installed lockfile versions.

## 0.2.0

### Minor Changes

- c9cb0a7: Add `createWebTorrentBackend`, a dependency-free `TorrentBackend` over a structural WebTorrent client that downloads magnet links inside the page, keeps only `wss://` trackers plus `DEFAULT_WEBRTC_TRACKERS`, and exposes `jobs`, `subscribe`, `pause`, `resume`, `remove` and `files`. `BackendTraits.handoff` is read on every availability check. `createDefaultBridges` takes an optional `torrent` backend that wins over the hand-off for magnet links, and `KernlOptions.torrent` passes one through `createKernl` (D-017).
