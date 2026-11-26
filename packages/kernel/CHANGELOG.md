# @kernlize/kernel

## 0.3.0

### Minor Changes

- d02cd45: **Breaking.** `KernlHost` loses the prompt callbacks that typed asks replaced (D-067): `presentConsent`, `presentApproval`, `chooseHandler`, `chooseReply` and `presentSettings`. A host draws every question through `KernlHost.asks`, one renderer per kind, and a kind with no renderer is refused. `AskHost` is now `Pick<KernlHost, 'asks'>`, and `createAskChannel` no longer falls back to a callback.

  A host that still passes a callback, directly or through `createKernl` from `@kernlize/preset` or `@kernlize/core`, gets no type error in JavaScript: the callback is ignored and its kinds are refused. Move each one to its renderers. A renderer returns the answer, sync or async, instead of calling `resolve`:

  - `presentConsent` becomes `sign.replace`, `upload.file`, `download.add` and `connection.direct`, each `(ask) => boolean`. The old `prompt.summary` is `ask.defaultText`.
  - `presentApproval` becomes `firewall.approve`, `(ask) => FirewallChoice | undefined`. The old `prompt.summary` is `ask.facts`, and `ask.signal` aborts when the question is withdrawn.
  - `chooseHandler`, `chooseReply` and `presentSettings` become `intent.choose-handler`, `messaging.choose-reply` and `settings.present`. Each receives its old prompt as `ask.facts` and returns what the callback resolved.

  `HandlerPrompt`, `ReplyPrompt` and `SettingsPrompt` are the facts of their kinds. `ConsentPrompt` and `FirewallPrompt`, the old callback arguments, stay exported for now.

## 0.2.0

### Minor Changes

- 6ad75bd: Only reuse an intent handler window that started with the `intent` domain and whose verified manifest declares the requested convention. Check the manifest again when the host opens the handler on demand, and keep kehto's recipient check for every delivery. The window entries in `KernlIntentDeps.handles` and `KernelContext.applets()` include their startup `domains`. `IntentDeliveryOptions.findWindow` receives the convention, and `send` receives the intended handler and convention for checking the opened window.
- 6ad75bd: Serve NAP-GAMEPAD: an applet the person granted `gamepad` reads controllers through the shell, which owns the only native reader (D-075). Every mounted frame keeps the Permissions-Policy denial, a subscriber receives a complete slot list, and live values reach only the window the window manager reports as focused; every other subscriber gets the neutral snapshot the proposal requires, so a press in one window cannot be replayed in another. Focus changes the window manager reports refresh every subscriber without waiting for a browser event or animation frame. The default preset includes `gamepadModule(settings)`. `KernlOptions.controllers` names the page that holds the reader and can withdraw the domain with `offer: false`. `gamepad.*` envelopes are classed `control`, so an applet's `unsubscribe` is not held while its window is hidden, and `gamepad` joins the domains that may stay in force for an applet that holds messages.
- 6ad75bd: `kernl.withGrantReview(summary, open)` keeps temporary applet grants in force during a reviewed replacement. The callback can reuse a mounted plan only when its startup domains still match, or plan and mount a fresh instance. Custom shell implementations must supply the new method.
- 6ad75bd: Add the Stacked layout. It shows one window at a time and temporarily minimises the rest without closing them or changing manual minimise choices. In every layout, `focus: false` keeps the current window in front. The host receives the focus option when opening a new handler. A connected handler can receive a request while hidden, but a fresh hidden handler still needs to be shown before it can connect.

### Patch Changes

- 6ad75bd: Only resolve applet manifests that match the requested event ID or address coordinate.
- 8e5de10: Share cached public Outbox observations across applets and identities, leave deletion handling to applets, and apply query filter limits to the combined cached and live events.
- Updated dependencies [6ad75bd]
  - @kernlize/guard@0.4.0

## 0.1.2

### Patch Changes

- d0e2306: An applet's `outbox.publish` reaches the person's write relays again. Under the firewall kehto plans the publish for the signer's key before signing, and the outbox router was given none, so the plan was empty and every publish came back `publish denied`. The relay pool also answered each relay by its normalized address (`wss://host/`), which kehto looked up by the address it planned (`wss://host`), so a publish the relays took still read as failed. The router now gets the signer's key, and publish results are keyed by the addresses kehto asked for.

## 0.1.1

### Patch Changes

- 7bf6b0b: Replay cached public tree events on approved Outbox subscriptions before opening the live relay read. One-shot Outbox queries merge cached events into the normal relay response. The cache module enables this without changes to applets or the Outbox API.
