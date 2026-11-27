# @kernlize/ui-model

## 0.3.1

### Patch Changes

- Updated dependencies [d02cd45]
  - @kernlize/kernel@0.3.0

## 0.3.0

### Minor Changes

- 6ad75bd: Applet stacks: the signed NIP-51 app curation sets (kind 30267) whose `a` tags name napplet manifests, read from the applet relays and the public relays. `kernl.stacks.stream(options?)` and `kernl.stacks.load(options?)` return one `AppletStack` per `(publisher, d)`, newest first, with the stack's `title` (then `name`, then the `d`), its description and its `members` — each a manifest coordinate with the catalogue id `resolve` takes and any relay hint the tag carried. A set that marks entry points with `['start', '<coordinate>']` tags marks those members `start`, which is how a shell installs a whole stack and opens only the applets it names; a marker naming no member is ignored. A set with no applet in it is not listed: republishing a set empty is how AppStore deletes one. `toAppletStack`, `newestStacks`, `streamStacks`, `loadStacks`, `stackRelays` and the `STACK_KIND`, `DEFAULT_STACK_ID`, `STACK_START_TAG`, `STACK_LIMIT`, `STACK_TIMEOUT_MS`, `STACK_SETTLE_MS` and `STACK_EMIT_MS` constants are exported too. The default shell loads `stacksModule()`; hosts composing their own modules can omit it (D-071).
- 6ad75bd: Serve NAP-GAMEPAD: an applet the person granted `gamepad` reads controllers through the shell, which owns the only native reader (D-075). Every mounted frame keeps the Permissions-Policy denial, a subscriber receives a complete slot list, and live values reach only the window the window manager reports as focused; every other subscriber gets the neutral snapshot the proposal requires, so a press in one window cannot be replayed in another. Focus changes the window manager reports refresh every subscriber without waiting for a browser event or animation frame. The default preset includes `gamepadModule(settings)`. `KernlOptions.controllers` names the page that holds the reader and can withdraw the domain with `offer: false`. `gamepad.*` envelopes are classed `control`, so an applet's `unsubscribe` is not held while its window is hidden, and `gamepad` joins the domains that may stay in force for an applet that holds messages.

### Patch Changes

- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
- Updated dependencies [8e5de10]
- Updated dependencies [6ad75bd]
- Updated dependencies [6ad75bd]
  - @kernlize/kernel@0.2.0
  - @kernlize/guard@0.4.0

## 0.2.4

### Patch Changes

- 2794231: The view models read the message seal and the ask kinds from `@kernlize/kernel/seal` and `@kernlize/kernel/asks`, and depend on `@kernlize/kernel` instead of `@kernlize/core` (D-068). Nothing they export changes.

## 0.2.3

### Patch Changes

- Updated dependencies [c6402c7]
  - @kernlize/core@0.30.0

## 0.2.2

### Patch Changes

- Updated dependencies [9478570]
  - @kernlize/core@0.29.0

## 0.2.1

### Patch Changes

- Updated dependencies [cbc86fd]
  - @kernlize/core@0.28.0

## 0.2.0

### Minor Changes

- 87dfd5b: Ask queues (#74): `createAskQueue` shows asks one at a time in arrival order, answers each to its own ask, and dismisses a revoked window's asks and withdrawn ones with their refusal, streaming what waits as `waiting$` and `current$`. `createAskQueues` makes one per kind, and `createAskRenderers` turns queues into `KernlHost.asks`; several kinds may share one queue.
- c887af4: Logs (#74): `createGuardLog`, `createTrafficLog`, `createNoticeStore` and `createUnreadCount` keep the newest events, per-window traffic with its marks, notices that go by themselves, and the shell's own unread count, framework-free and in memory only. `@kernlize/guard` and `@kernlize/messaging` are now dependencies, for their types.

### Patch Changes

- Updated dependencies [87dfd5b]
- Updated dependencies [f2996c2]
  - @kernlize/core@0.27.0

## 0.1.0

- First release: the grants list model (`startingChoices`, `grantGroups`, `grantsToApply`), its words and byte counts, moved from the web shell unchanged (D-060).
