# @kernlize/core

## 0.4.0

### Minor Changes

- 81fbff7: Add `@kernlize/core/crypto`: `installCryptoFallback` fills in `crypto.randomUUID` and a pure-JS `crypto.subtle` outside a secure context (onion or overlay addresses over HTTP). The mount plan gives applet frames a `randomUUID` fallback.

## 0.3.1

### Patch Changes

- a845ea5: Window management is a replaceable interface, and layouts are a registry (D-022).

  - New `createWindowManager` and the `WindowManager` interface: placement, focus, stacking, minimising and what the guard is told about each window, with no DOM, publishing `WindowManagerState` on `state$`.
  - New `createLayoutRegistry` and `createDefaultLayouts`: the layouts a window manager offers. `createDefaultLayouts` holds `floating`, `dwindle`, `columns` and `master-stack`.
  - New entry `@kernlize/core/wm`, exporting the layouts, the registry and the window manager without the network stack. The same names are exported from the main entry, which now also re-exports `LayoutStrategy`, `Rect`, `WindowPlacement` and `WindowState` from `@kehto/wm`.
  - `LayoutOptions.margin` sets the space between the windows and the container edge and defaults to `gap`.
  - The tiling layouts round rectangle edges rather than sizes, so neighbours never overlap or leave a hole when the space does not divide evenly. A width that does not divide evenly can differ by one pixel from before.

## 0.3.0

### Minor Changes

- 5726a3d: Publish npm packages under `@kernlize/*` and the same releases on JSR under `@kernl/*`. Update internal imports and the exported `PACKAGE_NAME` constants to the npm names. Generate JSR sources and dependency maps from the workspace and installed lockfile versions.
- 9b824bb: Adopt the host seams released in `@kehto/shell` 0.32.0, `@kehto/runtime` 0.28.0 and `@kehto/firewall` 0.7.0 (D-020).

  - Port traffic is decided through `ShellAdapter.filterNappletMessage`. `GuardPipeline.observe` now returns kehto's `NappletMessageDecision` (`dispatch`, `defer` or `drop`). Breaking: `refuseCurrentDispatch` is removed, and what the guard will not let through is dropped with no reply instead of refused with a `firewall:` error.
  - A hidden window's non-control requests are held and released with `ShellBridge.releaseDeferred` when it becomes visible (`GuardPipelineOptions.onRelease`), instead of refused. The `deferred-overflow` revocation removes the frame like every other reason.
  - The adapter sets `aclDefaultPolicy: 'restrictive'`; `KernlGrants.ensure` grants what the record needs and revokes only what the stored entry holds beyond it.
  - Breaking: `ShellAdapterDeps` replaces `onNappletMessage` with `filterNappletMessage`, `getFocusContext` and `runtimeFirewall`.
  - New `applyRuntimeFirewallProfile`, `createRuntimeFirewallHooks`, `toGuardEvent` and `RUNTIME_FIREWALL_STORAGE_KEY`: the runtime firewall gets the profile's unfocused multiplier and startup burst on boot and on every profile change, open windows get the new rates, runtime refusals become guard events without the applet's message, and the runtime firewall's configuration is kept at `kernl:firewall:v1`.
  - Requires `@kehto/services` ^0.30.1, `@napplet/core` >=0.38.0 <0.39.0 and `@napplet/nap` >=0.37.0 <0.38.0.

### Patch Changes

- Updated dependencies [5726a3d]
- Updated dependencies [9b824bb]
- Updated dependencies [9b824bb]
  - @kernlize/bridges@0.2.1
  - @kernlize/guard@0.1.1
  - @kernlize/messaging@0.3.0

## 0.2.0

### Minor Changes

- 50e5851: Add `createPrivateMessagesBackend` and `createLegacyMessagesBackend`, which carry messages with only the active account's signer, and wire them as the default `private` and `legacy` backends in `createKernl`. Availability now follows the active account. `MESSAGING_UNAVAILABLE_REASONS` is now `{ signInRequired, signerCannotEncrypt, noRuntime }`; `needs-local-key-signer` and `not-implemented` are gone.
- c9cb0a7: Add the `group` messaging provider: group sessions (Marmot, MLS over nostr) over `@internet-privacy/marmot-ts`, with the account signer for identity and invitations and every library store sealed to the account. `@kernlize/messaging` exports `createGroupMessagesProvider`; `@kernlize/core` exports `createGroupMessagesBackend`, `createSealedGroupStore` and `createGroupNetwork`, and `createKernl` wires the provider.
- c9cb0a7: Add `createWebTorrentBackend`, a dependency-free `TorrentBackend` over a structural WebTorrent client that downloads magnet links inside the page, keeps only `wss://` trackers plus `DEFAULT_WEBRTC_TRACKERS`, and exposes `jobs`, `subscribe`, `pause`, `resume`, `remove` and `files`. `BackendTraits.handoff` is read on every availability check. `createDefaultBridges` takes an optional `torrent` backend that wins over the hand-off for magnet links, and `KernlOptions.torrent` passes one through `createKernl` (D-017).
- c9cb0a7: Add `createRatchetMessagesBackend`, ratchet sessions over the `nostr-double-ratchet` runtime with the account signer signing the device list, and `createSealedRatchetStorage`, which keeps the library's device and session keys only as `nip44` ciphertext sealed to the account. `createKernl` wires it as the default `ratchet` backend, available while the signer has `nip44` (D-016).

### Patch Changes

- Updated dependencies [c9cb0a7]
- Updated dependencies [c9cb0a7]
  - @kernlize/messaging@0.2.0
  - @kernlize/bridges@0.2.0
