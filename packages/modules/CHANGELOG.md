# @kernlize/modules

## 0.3.0

### Minor Changes

- 6ad75bd: Applet stacks: the signed NIP-51 app curation sets (kind 30267) whose `a` tags name napplet manifests, read from the applet relays and the public relays. `kernl.stacks.stream(options?)` and `kernl.stacks.load(options?)` return one `AppletStack` per `(publisher, d)`, newest first, with the stack's `title` (then `name`, then the `d`), its description and its `members` — each a manifest coordinate with the catalogue id `resolve` takes and any relay hint the tag carried. A set that marks entry points with `['start', '<coordinate>']` tags marks those members `start`, which is how a shell installs a whole stack and opens only the applets it names; a marker naming no member is ignored. A set with no applet in it is not listed: republishing a set empty is how AppStore deletes one. `toAppletStack`, `newestStacks`, `streamStacks`, `loadStacks`, `stackRelays` and the `STACK_KIND`, `DEFAULT_STACK_ID`, `STACK_START_TAG`, `STACK_LIMIT`, `STACK_TIMEOUT_MS`, `STACK_SETTLE_MS` and `STACK_EMIT_MS` constants are exported too. The default shell loads `stacksModule()`; hosts composing their own modules can omit it (D-071).
- 6ad75bd: Only reuse an intent handler window that started with the `intent` domain and whose verified manifest declares the requested convention. Check the manifest again when the host opens the handler on demand, and keep kehto's recipient check for every delivery. The window entries in `KernlIntentDeps.handles` and `KernelContext.applets()` include their startup `domains`. `IntentDeliveryOptions.findWindow` receives the convention, and `send` receives the intended handler and convention for checking the opened window.
- 6ad75bd: Serve NAP-GAMEPAD: an applet the person granted `gamepad` reads controllers through the shell, which owns the only native reader (D-075). Every mounted frame keeps the Permissions-Policy denial, a subscriber receives a complete slot list, and live values reach only the window the window manager reports as focused; every other subscriber gets the neutral snapshot the proposal requires, so a press in one window cannot be replayed in another. Focus changes the window manager reports refresh every subscriber without waiting for a browser event or animation frame. The default preset includes `gamepadModule(settings)`. `KernlOptions.controllers` names the page that holds the reader and can withdraw the domain with `offer: false`. `gamepad.*` envelopes are classed `control`, so an applet's `unsubscribe` is not held while its window is hidden, and `gamepad` joins the domains that may stay in force for an applet that holds messages.
- 6ad75bd: Add the Stacked layout. It shows one window at a time and temporarily minimises the rest without closing them or changing manual minimise choices. In every layout, `focus: false` keeps the current window in front. The host receives the focus option when opening a new handler. A connected handler can receive a request while hidden, but a fresh hidden handler still needs to be shown before it can connect.

### Patch Changes

- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
- Updated dependencies [8e5de10]
- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
  - @kernlize/kernel@0.2.0
  - @kernlize/guard@0.4.0

## 0.2.0

### Minor Changes

- 5fc68c0: Each module has its own entry: `@kernlize/modules/messaging`, `@kernlize/modules/uploads`, `@kernlize/modules/profiles` and the rest, one per module. A host that imports a module from its entry makes the bundler read only that module, not every module kernl ships. The root entry still exports everything. A module now takes values only from the modules it `requires`; recipient lookup moved into messaging and the default relay suggestions are shared.
