# Guard

The guard is everything that stands between an applet and the user. Some of it is kehto's and kernl turns it on; some of it is kernl's and runs in front of kehto's bridge. The user sees it as one list of mitigations with reasons. This page is that list, with the numbers.

The rule from `SOUL.md`: if kehto ships a mitigation, kernl enables it by default and documents how to loosen it. The hosted shell boots `strict`, and there only the user loosens it ([D-003](../decisions.md#d-003)). An embedding host may choose the starting profile (`KernlOptions.guard.profile`), which changes limits only; the sandbox, the CSP, the frame lock and consent are fixed. In this draft the profile is shell-wide and resets to `strict` on every boot; per-applet profiles are planned ([Roadmap](../roadmap.md#_6-guard)).

**What refuses, what reports, what stops.** For an applet's port traffic, which is everything after the handshake, kehto's runtime firewall refuses an envelope before dispatch when it goes over the per-class rates kernl installs at mount, or over kehto's own startup burst. Size caps are refused before dispatch too: kernl measures the envelope and has the runtime firewall refuse that one dispatch. Otherwise kernl's ingress guard and focus firewall see each envelope synchronously, just before kehto dispatches it, but cannot hold or drop it: focus tightening, bursts above kernl's per-second rate and a hidden window's activity are reported as guard events, not refused. The exception is quarantine. When an envelope crosses the flood threshold, or a hidden window's download crosses its allowance, kernl revokes the binding inside the observation, so that envelope is not dispatched and the applet is closed ([Where enforcement happens](#where-enforcement-happens)). The visibility gate holds only the window-level `hello`. Signing consent is a third path, in the signer itself.

## The eleven mitigations

`describeMitigations(config)` in `@kernl/guard` returns this list as `MitigationDescription[]`, in this order, with the `limit` text computed from the profile in `config`. The shell renders it verbatim; the titles below are the ones the user sees, and they carry no protocol vocabulary. The third column is for developers and does.

| # | `id` | Title shown to the user | What it protects against | `provider` | `limit` in `strict` |
| --- | --- | --- | --- | --- | --- |
| 1 | `zero-network-sandbox` | Applets cannot reach the network on their own | Exfiltration, tracking pixels, loading code the user did not verify. The frame loads through `srcdoc` with `sandbox="allow-scripts"` and the CSP below, and kehto's prelude removes WebRTC before applet code runs. kernl refuses applet markup that declares a frame, and its frame lock stops applet code from creating one, so no child realm with a working peer connection can exist ([No network path](#no-network-path), [D-014](../decisions.md#d-014)). Every byte from the network arrives through a shell service. | `both` | none |
| 2 | `bound-identity` | An applet is only trusted while its connection and code match | A reloaded or substituted document inheriting grants, or one frame speaking for another. Identity is `(dTag, artifactHash)` plus the one `MessagePort` transferred in `napplet.hello`. Any other window-level message, a second `hello`, a `hello` without exactly one port, a second load or a closed port revokes the binding. | `kehto` | none |
| 3 | `verified-artifacts` | Applet code is verified before it runs, and again before reuse | A gateway or cache serving different code than the signed manifest names. Bytes are fetched by hash through `@kehto/nip/5d`, cached only after verification and re-verified on every read. | `kehto` | none |
| 4 | `replay-detection` | Old or repeated posts are not sent | The same signed post sent twice, or one dated to slip past a time window. kehto's replay detector runs on `relay.publish` after the shell signs: it refuses an event dated more than the replay window (30 s by default) in the past, more than 10 s in the future, or whose id it already saw inside the window. `outbox.publish` is not checked. A message from a window other than the applet's own is a port-binding matter, covered by `bound-identity`. | `kehto` | none |
| 5 | `rate-limits` | Applets have a budget for how often they can act | Publishing, subscribing or spending quota at a rate no human interaction explains. Refused before dispatch: kehto's runtime firewall refuses an over-budget envelope until the allowance refills, using the per-class rates kernl installs at mount, where deletions count against `relay:write`. The same firewall applies kehto's startup burst guard: more than 20 operations in a window's first 3 s are refused. kernl's focus firewall counts the classes again as each envelope arrives, including a separate `relay:publish:delete` bucket, and reports overruns as `rate:<class>` events. | `both` | `publish 20 per 60s, delete 5 per 60s, messages 20 per 60s` |
| 6 | `focus-tightening` | Applets you are not using are measured against a smaller budget | Background windows spending a foreground budget. Reported, not refused: kernl's focus firewall counts an unfocused window at `unfocusedMultiplier` of capacity as each envelope arrives and emits a guard event when it goes over, but the envelope is still dispatched. Focus is observed by the shell, never self-reported. The runtime firewall applies no unfocused multiplier at all: kehto's `ShellAdapter` does not forward `getFocusContext`, so the runtime treats every window as focused ([upstream gaps 1 and 4](../alpha-status.md#upstream-gaps)). The rate-limits budget above still applies in full. | `kernl` | `25% of the focused budget` |
| 7 | `hidden-deferral` | Hidden applets that keep downloading are stopped | Hidden or minimised applets consuming network budget the user cannot see. Each `resource.*` request from a hidden window counts against `hiddenResourceAllowance` as it arrives; the one past it quarantines the window (`flood:hidden-resource`): the binding is revoked inside the observation, so that request is not dispatched, and the frame is removed. Other port traffic from a hidden window is recorded, not held. The visibility gate holds only a hidden window's window-level `hello`. | `kernl` | `8 downloads while hidden` |
| 8 | `ingress-flood` | Applets that flood the shell are put in quarantine | A busy loop starving the shell's main thread. Per-window token bucket, counted as each port envelope arrives: bursts above `ingressBurst` are reported (`flood:burst`, `flood:queue-full`) and still dispatched. The message that reaches `quarantineThreshold` in 10 s quarantines the window: the binding is revoked inside the observation, so that message is not dispatched, and the frame is removed. Only the window-level `hello` is actually queued or rejected. | `kernl` | `8 messages per second, 300 per 10s` |
| 9 | `size-caps` | Oversized requests are refused | Memory pressure from oversized filters or payloads. The ingress guard measures `resource.*` and `relay.subscribe`/`outbox.subscribe` envelopes as they arrive and rejects an oversized one with `size:<class>`. kehto's runtime cannot measure these itself (it sizes only an envelope's `event`), so kernl calls `refuseCurrentDispatch`, which sets the applet's runtime policy to `deny` for that one synchronous dispatch and restores it in a microtask. The applet receives a `firewall:` error, nothing is fetched, and the user sees the guard event. An oversized `hello` is dropped. | `both` | `downloads 64 KiB, queries 256 KiB` |
| 10 | `device-denial` | Applets cannot use your camera, microphone or other devices | An applet reaching hardware. `denyNappletControllerAccess` gives the frame the Permissions Policy `gamepad 'none'; hid 'none'; usb 'none'`; the frame's `allow` attribute delegates nothing else, so camera, microphone and other powerful features stay off. There is no grant for any of them. | `kehto` | none |
| 11 | `destructive-consent` | Deleting or overwriting asks you first | An applet acquiring authority the user did not knowingly give. `createSigningConsent` asks `host.presentConsent` before a destructive kind (every replaceable kind 0, 3, 10000–19999; every addressable kind 30000–39999; 5; 62) is signed for an applet, after looking up the current version in the store and then on the outbox and discovery relays for up to `CURRENT_VERSION_TIMEOUT_MS` (4000 ms); if none is found the summary says "Current version: could not be loaded; this replaces it entirely". It runs on both routes: the window signer from `ShellAdapter.auth.getSigner(windowId)` for `relay.publish`, and kernl's outbox gate for `outbox.publish`. A denial is `denied:consent` and nothing is signed; answers are not remembered, and the shell's own signing is not gated. kehto's runtime has no such step. | `kernl` | none |

`enabled` is `true` for every row in every profile; the field exists for the UI contract. Two things are not separate rows: the opaque-origin frame, the CSP and the frame lock are one row (`zero-network-sandbox`), and kehto's startup burst guard is part of `rate-limits`, because the same runtime firewall applies both ([What `burstGuard` is for](#layers)). See `mitigations.feature`, scenario "every mitigation is described once, in display order".

## Operation classes

kehto's firewall treats the operation class as an opaque key. `classifyEnvelope` gives each inbound envelope one of eleven classes from its `type` and, for publishes, its `kind`:

| Envelope type | Class |
| --- | --- |
| `relay.publish`, `relay.publishEncrypted` with `kind: 5` | `relay:publish:delete` |
| `relay.publish`, `relay.publishEncrypted` (any other kind) | `relay:publish` |
| `relay.subscribe` | `relay:subscribe` |
| `outbox.subscribe`, `outbox.query`, `outbox.getEvent` | `outbox:subscribe` |
| `outbox.publish` (any kind, including 5) | `outbox:publish` |
| `resource.*` | `resource:bytes` |
| `storage.set`, `storage.remove` | `storage:write` |
| `dm.send` | `dm:send` |
| `intent.invoke`, `intent.open` | `intent:invoke` |
| `relay.close`, `outbox.close`, `storage.get`, `storage.keys`, `shell.*`, `inc.*`, `theme.*`, `identity.*`, other `dm.*` | `control` |
| anything else (`clipboard.write`, …) | `generic` |

`relay:publish:delete` gives kind 5 deletions their own, tighter bucket in kernl's focus firewall, so a burst of deletes is reported as `rate:relay:publish:delete`. In the layer that refuses there is no separate delete bucket: kehto's runtime firewall keys by capability, and deletions share the `relay:write` budget with other publishes ([translation table](#where-enforcement-happens)). What stops an unwanted deletion is signing consent, not the rate. See `classification.feature`.

## Profiles

A profile is a `GuardLimits` record plus the derived kehto `FirewallConfig`; `createGuardConfig(profile)` builds both. Profiles change limits only. `GUARD_PROFILES` lists them tightest first.

| Limit | `strict` (default) | `balanced` | `relaxed` |
| --- | --- | --- | --- |
| `ingressBurst` (messages per second before queueing) | 8 | 12 | 24 |
| `ingressQueue` (queued messages before rejection) | 64 | 128 | 192 |
| `quarantineThreshold` (messages per rolling 10 s before quarantine) | 300 | 420 | 800 |
| `hiddenResourceAllowance` (resource requests while hidden before quarantine) | 8 | 16 | 32 |
| `deferQueue` (held envelopes while hidden before rejection) | 200 | 400 | 600 |
| `maxResourceEnvelopeBytes` | 64 KiB (65 536) | 128 KiB (131 072) | 192 KiB (196 608) |
| `maxSubscribeEnvelopeBytes` | 256 KiB (262 144) | 512 KiB (524 288) | 768 KiB (786 432) |
| `unfocusedMultiplier` (rate capacity while unfocused) | 0.25 | 0.5 | 0.75 |

The per-class `rates` are a token-bucket capacity per window. `balanced` is exactly 2× `strict` and `relaxed` exactly 3×; the windows do not change.

| Class | Window | `strict` | `balanced` | `relaxed` |
| --- | --- | --- | --- | --- |
| `relay:subscribe` | 60 s | 30 | 60 | 90 |
| `relay:publish` | 60 s | 20 | 40 | 60 |
| `relay:publish:delete` | 60 s | 5 | 10 | 15 |
| `outbox:subscribe` | 60 s | 30 | 60 | 90 |
| `outbox:publish` | 60 s | 20 | 40 | 60 |
| `resource:bytes` | 10 s | 120 | 240 | 360 |
| `storage:write` | 10 s | 60 | 120 | 180 |
| `dm:send` | 60 s | 20 | 40 | 60 |
| `intent:invoke` | 60 s | 10 | 20 | 30 |
| `control` | 10 s | 120 | 240 | 360 |
| `generic` | 10 s | 120 | 240 | 360 |

Every rate kernl registers in kehto has exceed action `block`; kehto's own default would be `flag`. The shell boots in `strict`. [Change the guard profile](../how-tos/change-guard-profile.md) shows how a user changes the shell-wide profile; per-applet profiles are planned. See `profiles.feature`.

## Layers

Three stateful objects, each built from the same `GuardConfig`, each keyed by `windowId`, each with a `forget(windowId)` to call on revocation. This section describes each layer's own API, which is what a caller that sits in front of dispatch gets. In the composed shell that is true only for the window-level `hello`; for port traffic the dispositions below become events and, for `quarantine`, a revocation that also stops the envelope that triggered it ([Where enforcement happens](#where-enforcement-happens)).

| Layer | Enforces | Factory |
| --- | --- | --- |
| Ingress guard | `ingressBurst`, `ingressQueue`, `quarantineThreshold`, `hiddenResourceAllowance`, both envelope size caps | `createIngressGuard({ config, now?, onEvent?, drainBatch? })` |
| Visibility gate | `deferQueue`; which classes wait while hidden | `createVisibilityGate({ config, now?, onEvent?, nappletFor? })` |
| Focus firewall | kehto `evaluate()`: per-applet class rates, the `generic` default rate, the content matchers, `unfocusedMultiplier`, per-applet policies | `createFocusFirewall({ config, now?, onEvent? })` |

**Ingress guard.** Each window has a token bucket of `ingressBurst` per second. While tokens remain, `admit` returns `pass`. When they are spent, or while anything is already queued, the envelope is queued and `admit` returns `defer` with reason `flood:burst`; nothing overtakes the queue. Past `ingressQueue` the envelope is rejected with `flood:queue-full`. `drain(windowId)` releases at most `drainBatch` (default 4) queued envelopes, never more than the refilled tokens allow, ordered `control` first, then `resource:bytes`, then everything else, oldest first within a rank. Arrivals are counted over a rolling `QUARANTINE_WINDOW_MS` (10 s); the arrival that reaches `quarantineThreshold` quarantines the window with `flood:quarantine`, drops its queue, and every later envelope returns `quarantine` with the same reason until `release(windowId)` (fresh budget, quarantine lifted) or `forget(windowId)`. While a window is hidden, each `resource:bytes` envelope counts against `hiddenResourceAllowance`; the one past it quarantines with `flood:hidden-resource`. Any admission while visible resets that count. An envelope whose class has a size cap and whose `size` exceeds it is rejected with `size:<class>`; an envelope without a `size` is not size-checked. A clock that runs backwards grants no tokens. See `ingress.feature`.

**Visibility gate.** The shell reports visibility with `setVisibility`; a window it has not reported on counts as visible and unfocused. `shouldDefer(windowId, opClass)` is true when the window is hidden and the class is not `control`, so a hidden window can still be closed, themed or asked for its identity. `defer` queues up to `deferQueue` envelopes and then returns `false` while emitting a `reject` event with reason `defer:queue-full`; the event names the applet through `nappletFor`, or `unknown` without one. `drain` returns every held envelope oldest first and empties the queue. Deferral is a privacy and resource measure, not a rate limit: a minimised applet should not fetch or publish while the user cannot see it. See `visibility.feature`.

**Focus firewall.** `observe` builds a kehto `Observation` from the envelope and the shell's `WindowVisibility` (`focused`, and `msSinceFocusGain` when known) and runs `evaluate()`. On the first observation of an applet it calls `applyNappletRules` so the applet's class rates exist in kehto's per-applet map; kehto keys those budgets by applet (`dTag`), so two windows of the same applet share a budget (`focus-firewall.feature`, scenario "budgets are per applet, not per window"). Decisions map to events: `reject` emits `reject`; `pass` with action `flag` emits `flag`; `prompt` emits `reject` with reason `prompt:<ruleId>`. kernl treats a prompt as a denial here because the layer has no UI; signing consent for destructive writes is a separate path, in the signer wrapper, not in the firewall. kehto's `rate:*` rule ids name the tier (`rate:opclass`, `rate:global`, `rate:default`); the event reason is rewritten to `rate:<class>` so the user sees what ran out. Other rule ids pass through unchanged, for example `matcher:size:resource:bytes` and `policy:deny`. In the composed shell a `matcher:size:*` event cannot occur: the ingress guard applies the same caps first, and the pipeline runs the focus firewall only for envelopes the ingress guard passed. `forget(windowId)` drops the buckets of every applet seen in that window, which also resets the budget of another window running the same applet; revocation is user-driven, so that is accepted.

**What `burstGuard` is for.** `createGuardConfig` sets `firewall.burstGuard` to `{ windowMs: 1000, maxOps: ingressBurst, action: 'block' }`. kehto's init-burst guard only fires for callers that supply `initElapsedMs` in the observation, and the focus firewall never does, so this field never fires inside `@kernl/guard`. The guard that does fire is the runtime's: kehto's runtime supplies `initElapsedMs` (time since the window's session registered) and evaluates its own configuration, kehto's default of 20 operations in the first 3 s with action `block`, because kernl installs rates in the runtime and nothing else. An applet that sends more than 20 envelopes in its first 3 s has the excess refused with a `firewall:` error.

## Where enforcement happens

kehto's bridge owns the `MessagePort` an applet speaks over and shows the host that traffic only through `ShellAdapter.onNappletMessage`. kehto's `dispatchEnvelope` calls that hook synchronously for each envelope, before it resolves the window's session and hands the envelope to the runtime, and ignores the hook's answer. kernl therefore observes every envelope before dispatch but cannot hold or drop it ([D-001](../decisions.md#d-001)). Enforcement is layered ([D-012](../decisions.md#d-012)):

| Traffic | Where | How |
| --- | --- | --- |
| The window-level `napplet.hello` | kernl, before kehto sees it | `Kernl.handleWindowMessage` resolves the sending window from `originRegistry`, never from the message, and runs ingress guard → visibility gate → focus firewall before `bridge.handleMessage`. This is the one message the pipeline can hold or drop; any other window-level message from a bound applet is kehto's `window-message` revocation. |
| Port traffic, observed | kernl, inside `onNappletMessage`, before dispatch | `onNappletMessage` feeds `GuardPipeline.observe`: the ingress guard and the focus firewall advance their counters and emit events, and the envelope continues to the runtime. A `quarantine` disposition calls `onQuarantine`, which marks the handle revoked with reason `quarantine` and calls `bridge.revokeNapplet(windowId, 'host')` while kehto is still inside the hook. kehto then finds no session for the window and does not dispatch the envelope, and the frame is removed. Quarantine is the only outcome here that stops an envelope. |
| Port traffic, refused by rate | kehto's runtime firewall, configured by kernl | `kernl.mount` calls `applyRuntimeFirewallRules(bridge.runtime.firewallState, config, dTag)`, which installs the profile's per-class rates and global rate for that applet. It sets no policy: kehto's `allow` policy would make `evaluate()` skip every rate, matcher and burst check. The runtime refuses over-budget envelopes, and envelopes past its startup burst, itself, before it handles them, and answers the applet with an error that starts `firewall:`. Rates are installed at mount: a window keeps the rates it was mounted with until it is opened again. |
| Port traffic, refused by size | kernl's ingress guard, enforced by kehto's runtime firewall | When the ingress guard emits `size:<class>` inside `onNappletMessage`, `createKernl` calls `refuseCurrentDispatch(bridge.runtime.firewallState, dTag)`: the applet's runtime policy is `deny` for the rest of that synchronous dispatch, so kehto refuses the envelope, and the previous policy returns in a microtask, before the next port message can arrive. |

The runtime keys its rates by the sender capability a message needs, while the guard classifies by what a message does. `RUNTIME_OP_CLASSES` translates:

| Guard class | Runtime key |
| --- | --- |
| `relay:subscribe` | `relay:read` |
| `relay:publish` | `relay:write` |
| `relay:publish:delete` | none; deletions share `relay:write` in the runtime and keep their own bucket only in kernl's focus firewall, which reports |
| `outbox:subscribe` | `outbox:read` |
| `outbox:publish` | `outbox:write` |
| `resource:bytes` | `resource:fetch` |
| `storage:write` | `state:write` |
| `dm:send` | `dm:write` |
| `intent:invoke` | `intent:write` |
| `control` | none; control envelopes need no capability |
| `generic` | the per-applet global rate (`setGlobalRate`) |

Two limits of this arrangement are stated plainly. The runtime firewall never applies an unfocused multiplier: kehto's `ShellAdapter` does not forward `getFocusContext`, so the runtime builds every observation as focused, and `FirewallStateContainer` has no setter for `unfocusedMultiplier` either. The profile's value (`0.25` in `strict`) is applied only by kernl's focus firewall, which reports. And hidden-window deferral is advisory for port traffic in this draft: the visibility gate holds only window-level messages, and `observe` cannot hold a port envelope, so for a hidden window the gate's effect is the tightened, reported budget, the hidden-resource allowance that quarantines, and the event trail, not a held queue. Both are recorded as upstream gaps in [Alpha status](../alpha-status.md#upstream-gaps).

## Dispositions and reasons

`IngressGuard.admit()` returns one of four dispositions:

| Disposition | Meaning | For the window-level `hello` | For port traffic (observed, not held) |
| --- | --- | --- | --- |
| `pass` | Within budget. | Forwarded to the bridge after the visibility gate and the focus firewall. | Nothing; the envelope is dispatched. |
| `defer` | The per-second burst is spent; the envelope is queued. | Held; `drainAll` forwards it as tokens refill. | A `flood:burst` event. The envelope is still dispatched. |
| `reject` | The queue is full or the envelope is over its size cap. | Dropped. | `flood:queue-full`: an event, and the envelope is still dispatched. `size:<class>`: an event, and the runtime firewall refuses the envelope (`refuseCurrentDispatch`). |
| `quarantine` | The window hit the quarantine threshold or the hidden resource allowance, or is still quarantined. | Dropped, and the window is revoked. | `onQuarantine` revokes the binding inside the hook, so this envelope is not dispatched, and the frame is removed. |

Every disposition other than `pass`, and every `pass` the firewall flagged, emits a `GuardEvent` with a stable prefixed reason. The user sees these events; secrets never appear in them.

| Reason | Emitted by | With disposition |
| --- | --- | --- |
| `flood:burst` | ingress guard | `defer` |
| `flood:queue-full` | ingress guard | `reject` |
| `flood:quarantine` | ingress guard | `quarantine` |
| `flood:hidden-resource` | ingress guard | `quarantine` |
| `size:<class>` (`size:resource:bytes`, `size:relay:subscribe`, `size:outbox:subscribe`) | ingress guard | `reject` |
| `defer:queue-full` | visibility gate | `reject` |
| `rate:<class>` | focus firewall | `reject`, or `flag` when the rate's action is `flag` |
| `matcher:<id>`, kehto's rule id passed through; the guard's own `matcher:size:*` matchers cannot fire in the composed shell, because the ingress guard rejects the same envelopes first | focus firewall | `reject` |
| `policy:deny` | focus firewall | `reject` |
| `prompt:<ruleId>` (`prompt:policy:ask`) | focus firewall | `reject` |

## Why CSP never loosens

The three profiles scale rates and queues. None of them touches the Content Security Policy. A profile is a statement about how much an applet may do through the shell; the CSP is a statement about whether an applet may bypass the shell at all. Loosening a rate limit lets a trusted applet work faster. Loosening the CSP would let it talk to the network directly, which removes the shell's ability to see, rate-limit and revoke that traffic and so removes every other mitigation on this page at once.

`createAppletCsp(profile)` therefore accepts the profile, so that callers configure one place, and ignores it. It returns `connectOrigins: []` and kehto's zero-network baseline of 14 directives, which `renderCsp` serialises as:

```
default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'
```

An applet that needs a network resource asks the `resource` domain, and the request goes through a [bridge](./bridges.md). See `csp.feature`, scenario "the relaxed profile does not loosen the CSP".

## No network path

`zero-network-sandbox` has three parts: the CSP, kehto's prelude, and kernl's frame lock.

**kehto's prelude.** `prepareNappletSrcdoc` puts it in the frame right after the CSP `<meta>`, so it runs before any applet code. Before it opens the port to the shell, the prelude takes every global whose name starts with `RTC`, plus `webkitRTCPeerConnection`, `mozRTCPeerConnection`, `webkitRTCSessionDescription`, `mozRTCSessionDescription`, `webkitRTCIceCandidate` and `mozRTCIceCandidate`, and redefines each as `undefined`, read-only, non-configurable and non-enumerable. The names still exist, but no value can be put back: `delete` and assignment leave them `undefined`. A peer connection would otherwise be a way out the CSP does not cover.

**kernl's frame lock** ([D-014](../decisions.md#d-014)). The prelude cleans only the applet's own realm. A child frame made from `srcdoc` or `about:blank` is a fresh realm with a working `RTCPeerConnection`, and no CSP directive reaches it, because creating it involves no fetch. `@kehto/shell` 0.29.0 has no switch for this; kehto's unreleased `experimental.nestedContextLock` closes it, and `@kernl/guard` carries an attributed port of that lock until a release ships it. `planMount` applies all of it to every applet:

- `assertAppletHasNoFrame` scans the verified bytes and refuses markup that contains an `iframe`, `frame`, `frameset`, `object`, `embed`, `portal` or `fencedframe` element with `denied:nested-frame`. It parses with the host's `DOMParser` and falls back to a lexical match, which may over-reject.
- `renderFrameLockScript()` is inserted immediately after kehto's prelude, before any applet script. It installs a Trusted Types `default` policy that refuses frame markup, namespace-prefixed tags included, at every HTML string sink (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `createContextualFragment`, `DOMParser`), and pins `Document.prototype.createElement`, `createElementNS` and `DOMImplementation.prototype.createDocument` non-configurable so they throw `TypeError: denied:nested-frame` for a frame tag name.
- The same script runs `appletInsertionLock`, because creation routes are open-ended (custom element constructors, XSLT, namespace-prefixed XML parsing all mint frames without a factory) but a frame gets a realm only when it is connected. It pins every DOM insertion method (`appendChild`, `insertBefore`, `replaceChild`, `append`, `prepend`, `replaceChildren`, `before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `Range.insertNode`, `Range.surroundContents`) to refuse a node that is, or contains, a frame element, reading node identity through native getters captured before applet code runs. It also refuses custom elements that extend frame elements and removes `XSLTProcessor`. Every insertion therefore walks the inserted subtree once.
- The CSP `<meta>` kehto rendered gains `TRUSTED_TYPES_DIRECTIVES`, `require-trusted-types-for 'script'; trusted-types default`, so every string sink goes through that policy and no other policy name can be registered. `createAppletCsp` carries the directives as `AppletCsp.trustedTypes`. kehto 0.29.0 refuses directives outside its baseline, so `planMount` appends them to the rendered meta, and refuses with `unavailable:frame-lock` when kehto's output is not where it expects it.

**The CSP** refuses everything else: `fetch` and WebSocket by `connect-src 'none'`, images by `img-src data: blob:`, frames that would load a URL by `frame-src 'none'` and `child-src 'none'`, and beacons by `connect-src`. `navigator.sendBeacon` still returns `true`, because it only reports that the beacon was queued; the request is refused when the browser sends it, and fails with `csp`.

`tests/e2e/applet-network-sealed.spec.ts` proves this in Chromium. It builds an applet frame with kernl's own `planMount` (`sandbox="allow-scripts"`, a host page carrying `KERNL_FRAME_POLICY_META`) and checks that the frame lock follows kehto's prelude and precedes the applet's script. The applet code then tries each way out, and the spec asserts:

- each of 15 frame-creation routes, plus `document.write` whole and split across calls, throws `TypeError: denied:nested-frame`; the four creation routes the factories cannot see (a customized built-in constructed with `new`, XSLT, and a namespace-prefixed XHTML element brought in with `importNode` or `adoptNode`) fail at creation or at insertion; and thirteen insertion routes (every pinned method, a shadow root, a fragment) refuse an unconnected frame;
- no child realm exists, no `RTC*` constructor is usable in the applet's realm, and no realm produces a `srflx` or `relay` ICE candidate. As a control, when the host page can reach a public STUN server, the spec asserts that it does and that the applet produces no such candidate; when it cannot, the control is skipped;
- `fetch` fails, the WebSocket never opens, every `RTC*` global is pinned to `undefined` and cannot be restored, the image does not load, the browser reports a CSP violation for each attempt including the beacon, and no request reaches the network layer: every outbound request fails with `csp`.

[D-014](../decisions.md#d-014) records the negative control: the same probe run against a srcdoc built by kehto 0.29.0 alone lets 11 routes escape, each producing a child realm that reports `host` and `srflx` candidates.

## What the guard is not

It is not an access control list. Whether an applet may use a domain is a grant, described in [Identity and grants](./identity-and-grants.md). The guard assumes the grant exists and asks a different question: is this applet abusing what it was granted, right now?

## Related

- [`@kernl/guard`](../packages/guard.md)
- [Change the guard profile](../how-tos/change-guard-profile.md)
- [Applets under kernl](./applets-under-kernl.md)
