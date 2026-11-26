# @kernlize/guard

## 0.4.0

### Minor Changes

- 6ad75bd: Serve NAP-GAMEPAD: an applet the person granted `gamepad` reads controllers through the shell, which owns the only native reader (D-075). Every mounted frame keeps the Permissions-Policy denial, a subscriber receives a complete slot list, and live values reach only the window the window manager reports as focused; every other subscriber gets the neutral snapshot the proposal requires, so a press in one window cannot be replayed in another. Focus changes the window manager reports refresh every subscriber without waiting for a browser event or animation frame. The default preset includes `gamepadModule(settings)`. `KernlOptions.controllers` names the page that holds the reader and can withdraw the domain with `offer: false`. `gamepad.*` envelopes are classed `control`, so an applet's `unsubscribe` is not held while its window is hidden, and `gamepad` joins the domains that may stay in force for an applet that holds messages.

## 0.3.1

### Patch Changes

- 9f957d9: The `media` domain: `kernl.media` lists what applets play and plays a source for them under six settings the person chooses (one at a time or several, pause or end the earlier, videos in a window or in the player, hidden windows, starting on its own, and whether what the shell plays keeps playing, pauses or stops when its applet closes). `createKernlServices` registers it and now needs `host.storage`.

  The guard no longer holds back an applet's reports on a media session while its window is hidden; making a session still waits until it is shown.

## 0.3.0

### Minor Changes

- 4d19b2a: kehto's firewall is now an approval authority and its temporal engine moved to `@kehto/rate-limit`; kernl adopts both (D-056).

  `@kernlize/guard`: `createFocusFirewall` is `createFocusRateLimiter`, over `@kehto/rate-limit`'s `evaluateRateLimit` with one budget per operation class in `GuardConfig.rateLimits`. `applyNappletRules`, `GuardConfig.firewall` and the legacy engine are gone. A `firewall` mitigation is described.

  `@kernlize/core`: the shell configures kehto's `permissions`. Every applet is admitted by the firewall in `plan`, and every request is put to it. `defaultFirewallRules` allows what the person granted and asks about every link. `Kernl.firewall` sets rules and takes answers back; `KernlHost.presentApproval` shows a question; `KernlHost.openLink` is told when a link was already approved. `createRuntimeRateLimiter` replaces the legacy rate gate, and the `runtime-rules` exports are removed.

### Patch Changes

- 6bc9b41: Keyboard shortcuts work for every applet. `keys` is now a baseline domain served by `createShortcutsService`: an applet gets the key it asks for, is told its bindings, and has its action run in the focused window. A keymap registered as an applet starts is held through the startup window instead of being refused, a held key's repeats no longer count as a flood, and the guard classifies `keys.*` as `control`. `createKernlServices` requires `shortcuts`, `KernlOptions.shortcuts` reserves the host's own chords, and `KernlHost.onShortcut` receives the keys an applet forwards.

## 0.2.1

### Patch Changes

- 0f8efb1: Say "identity" instead of "account" in the consent summaries and mitigation descriptions people read.

## 0.2.0

### Minor Changes

- 4fa61e5: Move to `@kehto/shell` 0.35, `@kehto/services` 0.34, `@kehto/runtime` 0.30, `@kehto/acl` 0.20.6, `@napplet/core` 0.41, `@napplet/nap` 0.40 and applesauce 7.1 (D-037).

  - **core:** `createRuntimeFirewallHooks` now constructs the runtime firewall from `@kehto/rate-limit/legacy` and returns it as `legacyFirewall` in place of `firewallPersistence`, because the runtime no longer builds one. The stored configuration under `kernl:firewall:v1` keeps its format. New `createAppletRelayService` plans relay publishes by event kind for kehto's planned relay contract. Signers are kept stable per account and window so the identity and relay services deliver their replies. Intents are delivered through the runtime's recipient gate. The shell's pool is built with the new `SHELL_RELAY_OPTIONS`, one redial after a second for publishes and requests, because applesauce-relay 7.1 otherwise holds a publish to a dead relay for about six seconds. A manifest lookup lets applesauce-relay redial a refused relay once instead of repeating the round. The `@napplet/core` peer range is now `>=0.41.0 <0.42.0` and `@napplet/nap` `>=0.37.0 <0.41.0`.
  - **guard:** the temporal engine moved from `@kehto/firewall` to `@kehto/rate-limit/legacy`; the guard depends on `@kehto/rate-limit` and its `GuardConfig.firewall` and `FocusFirewall.observe` types come from there. The `@napplet/core` peer range widens to `<0.42.0`.
  - **messaging:** the `@napplet/core` peer range widens to `<0.42.0`.

## 0.1.1

### Patch Changes

- 5726a3d: Publish npm packages under `@kernlize/*` and the same releases on JSR under `@kernl/*`. Update internal imports and the exported `PACKAGE_NAME` constants to the npm names. Generate JSR sources and dependency maps from the workspace and installed lockfile versions.
- 9b824bb: Depend on `@kehto/firewall` ^0.7.0 and accept `@napplet/core` 0.38. The `hidden-deferral` mitigation now says a hidden applet's requests are held until it is visible, and `focus-tightening` is provided by both kehto and kernl, because the runtime firewall applies the unfocused multiplier too (D-020).
