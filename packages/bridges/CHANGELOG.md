# @kernlize/bridges

## 0.2.1

### Patch Changes

- 5726a3d: Publish npm packages under `@kernlize/*` and the same releases on JSR under `@kernl/*`. Update internal imports and the exported `PACKAGE_NAME` constants to the npm names. Generate JSR sources and dependency maps from the workspace and installed lockfile versions.

## 0.2.0

### Minor Changes

- c9cb0a7: Add `createWebTorrentBackend`, a dependency-free `TorrentBackend` over a structural WebTorrent client that downloads magnet links inside the page, keeps only `wss://` trackers plus `DEFAULT_WEBRTC_TRACKERS`, and exposes `jobs`, `subscribe`, `pause`, `resume`, `remove` and `files`. `BackendTraits.handoff` is read on every availability check. `createDefaultBridges` takes an optional `torrent` backend that wins over the hand-off for magnet links, and `KernlOptions.torrent` passes one through `createKernl` (D-017).
