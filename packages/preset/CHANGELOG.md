# @kernlize/preset

## 0.3.1

### Patch Changes

- Updated dependencies [d02cd45]
  - @kernlize/kernel@0.3.0
  - @kernlize/modules@0.3.1

## 0.3.0

### Minor Changes

- 6ad75bd: Applet stacks: the signed NIP-51 app curation sets (kind 30267) whose `a` tags name napplet manifests, read from the applet relays and the public relays. `kernl.stacks.stream(options?)` and `kernl.stacks.load(options?)` return one `AppletStack` per `(publisher, d)`, newest first, with the stack's `title` (then `name`, then the `d`), its description and its `members` — each a manifest coordinate with the catalogue id `resolve` takes and any relay hint the tag carried. A set that marks entry points with `['start', '<coordinate>']` tags marks those members `start`, which is how a shell installs a whole stack and opens only the applets it names; a marker naming no member is ignored. A set with no applet in it is not listed: republishing a set empty is how AppStore deletes one. `toAppletStack`, `newestStacks`, `streamStacks`, `loadStacks`, `stackRelays` and the `STACK_KIND`, `DEFAULT_STACK_ID`, `STACK_START_TAG`, `STACK_LIMIT`, `STACK_TIMEOUT_MS`, `STACK_SETTLE_MS` and `STACK_EMIT_MS` constants are exported too. The default shell loads `stacksModule()`; hosts composing their own modules can omit it (D-071).
- 6ad75bd: Serve NAP-GAMEPAD: an applet the person granted `gamepad` reads controllers through the shell, which owns the only native reader (D-075). Every mounted frame keeps the Permissions-Policy denial, a subscriber receives a complete slot list, and live values reach only the window the window manager reports as focused; every other subscriber gets the neutral snapshot the proposal requires, so a press in one window cannot be replayed in another. Focus changes the window manager reports refresh every subscriber without waiting for a browser event or animation frame. The default preset includes `gamepadModule(settings)`. `KernlOptions.controllers` names the page that holds the reader and can withdraw the domain with `offer: false`. `gamepad.*` envelopes are classed `control`, so an applet's `unsubscribe` is not held while its window is hidden, and `gamepad` joins the domains that may stay in force for an applet that holds messages.
- `previewPreset` loads `stacksModule()`, and `shippedSamples` seeds the signed stacks a `samples.json` carries in its new optional `stacks` field, so the preview's Stacks tab lists the samples' stacks from the page's relays.
- 6ad75bd: Add the Stacked layout. It shows one window at a time and temporarily minimises the rest without closing them or changing manual minimise choices. In every layout, `focus: false` keeps the current window in front. The host receives the focus option when opening a new handler. A connected handler can receive a request while hidden, but a fresh hidden handler still needs to be shown before it can connect.

### Patch Changes

- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
- Updated dependencies [8e5de10]
- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
  - @kernlize/modules@0.3.0
  - @kernlize/kernel@0.2.0

## 0.2.1

### Patch Changes

- Updated dependencies [5fc68c0]
  - @kernlize/modules@0.2.0

## 0.2.0

### Minor Changes

- `createMemoryRelays` gives applesauce's real `RelayPool` relays that live in the page: a WebSocket that never leaves memory, answering as NIP-01 relays do from one store every URL shares. It is the first part of `previewPreset` (#75).
- 60c4e73: `previewPreset(options)` runs the real kernel and kernl's own modules offline, over parts that live in the page (D-068). Relays are in memory, and the samples' signed manifests are served by hash for the kernel to verify. Ada and Grace have already written, download programs answer their checks, and web pages and tool searches are refused. `shippedSamples` reads the samples' `samples.json`, and `PREVIEW_CORRESPONDENTS` and `PREVIEW_REPLIES` name the scripted people and what they answer.
