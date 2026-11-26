---
'@kernlize/modules': minor
'@kernlize/preset': minor
'@kernlize/ui-model': minor
---

Applet stacks: the signed NIP-51 app curation sets (kind 30267) whose `a` tags name napplet manifests, read from the applet relays and the public relays. `kernl.stacks.stream(options?)` and `kernl.stacks.load(options?)` return one `AppletStack` per `(publisher, d)`, newest first, with the stack's `title` (then `name`, then the `d`), its description and its `members` — each a manifest coordinate with the catalogue id `resolve` takes and any relay hint the tag carried. A set that marks entry points with `['start', '<coordinate>']` tags marks those members `start`, which is how a shell installs a whole stack and opens only the applets it names; a marker naming no member is ignored. A set with no applet in it is not listed: republishing a set empty is how AppStore deletes one. `toAppletStack`, `newestStacks`, `streamStacks`, `loadStacks`, `stackRelays` and the `STACK_KIND`, `DEFAULT_STACK_ID`, `STACK_START_TAG`, `STACK_LIMIT`, `STACK_TIMEOUT_MS`, `STACK_SETTLE_MS` and `STACK_EMIT_MS` constants are exported too. The default shell loads `stacksModule()`; hosts composing their own modules can omit it (D-071).
