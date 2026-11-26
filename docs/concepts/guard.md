# Guard

The guard is everything that stands between an applet and the user. Some of it is kehto's and kernl turns it on; some of it is kernl's and runs in front of kehto's bridge. The user sees it as one list of mitigations with reasons. Most of it measures how much an applet does; one part, the [firewall](#the-firewall), decides whether a request goes ahead at all. This page is that list, with the numbers.

The rule from `SOUL.md`: if kehto ships a mitigation, kernl enables it by default and documents how to loosen it. The hosted shell boots `strict`, and there only the user loosens it ([D-003](../decisions.md#d-003)). An embedding host may choose the starting profile (`KernlOptions.guard.profile`), which changes limits only; the sandbox, the CSP, the frame lock and consent are fixed. In this draft the profile is shell-wide and resets to `strict` on every boot; per-applet profiles are planned ([Roadmap](../roadmap.md#_6-guard)).

**What drops, what holds, what refuses, what stops.** For an applet's port traffic, which is everything after the handshake, kernl decides each envelope before kehto's runtime sees it, through kehto's `filterNappletMessage` ([D-020](../decisions.md#d-020)). An oversized request, a burst above kernl's per-second rate and a request over its class budget, which is smaller while the window is unfocused, are dropped: nothing is handled, the applet gets no reply, and the user sees a guard event. A hidden window's non-control requests are held and handled, in order, once it is visible. Control envelopes (`shell.*`, `inc.*`, `theme.*`, closes and the other `control` classes) are dispatched, so a window stays controllable; once a hidden window holds a request, kehto queues its later envelopes behind it. kehto's runtime then charges what it carries out against the same class budgets, which kernl hands it as `permissions.rateLimiter`, at the focus kernl reports. A request over one is refused with `rate limit exceeded`; held envelopes meet the budget when they are released. Its refusals are guard events too. Each request the runtime carries out is also put to the [firewall](#the-firewall), which lets it go ahead, asks the user or refuses it. Quarantine goes further. When an envelope crosses the flood threshold, or a hidden window's download crosses its allowance, kernl revokes the binding inside the filter, so that envelope is not dispatched, what the window held is discarded, and the applet is closed ([Where enforcement happens](#where-enforcement-happens)). Signing consent is a separate path, in the signer itself.

## The twelve mitigations

`describeMitigations(config)` in `@kernlize/guard` returns this list as `MitigationDescription[]`, in this order, with the `limit` text computed from the profile in `config`. The shell renders it verbatim; the titles below are the ones the user sees, and they carry no protocol vocabulary. The third column is for developers and does.

| # | `id` | Title shown to the user | What it protects against | `provider` | `limit` in `strict` |
| --- | --- | --- | --- | --- | --- |
| 1 | `zero-network-sandbox` | Applets cannot reach the network on their own | Exfiltration, tracking pixels, loading code the user did not verify. The frame loads through `srcdoc` with `sandbox="allow-scripts"` and the CSP below, and kehto's prelude removes WebRTC before applet code runs. Applet markup that declares a frame is refused, and kehto's nested-context lock with kernl's insertion lock stops applet code from creating or connecting one, so no child realm with a working peer connection can exist ([No network path](#no-network-path), [D-014](../decisions.md#d-014)). Every byte from the network arrives through a shell service. | `both` | none |
| 2 | `bound-identity` | An applet is only trusted while its connection and code match | A reloaded or substituted document inheriting grants, or one frame speaking for another. Identity is `(dTag, artifactHash)` plus the one `MessagePort` transferred in `napplet.hello`. Any other window-level message, a second `hello`, a `hello` without exactly one port, a second load or a closed port revokes the binding. | `kehto` | none |
| 3 | `verified-artifacts` | Applet code is verified before it runs, and again before reuse | A gateway or cache serving different code than the signed manifest names. Bytes are fetched by hash through `@kehto/nip/5d`, cached only after verification and re-verified on every read. | `kehto` | none |
| 4 | `replay-detection` | Old or repeated posts are not sent | The same signed post sent twice, or one dated to slip past a time window. kehto's replay detector runs on `relay.publish` after the shell signs: it refuses an event dated more than the replay window (30 s by default) in the past, more than 10 s in the future, or whose id it already saw inside the window. `outbox.publish` is not checked. A message from a window other than the applet's own is a port-binding matter, covered by `bound-identity`. | `kehto` | none |
| 5 | `rate-limits` | Applets have a budget for how often they can act | Publishing, subscribing or spending quota at a rate no human interaction explains. Refused before dispatch, in two places. kernl's focus-aware rate limiter charges each envelope against its class budget as it arrives, with a separate `relay:publish:delete` budget, and drops an overrun with a `rate:<class>` event. kehto's runtime then charges what it carries out against the same budgets, which kernl hands it as `permissions.rateLimiter` and which follow a profile change at once; there deletions share the `relay:publish` budget, and a refusal reads `rate limit exceeded`. | `both` | `publish 20 per 60s, delete 5 per 60s, messages 20 per 60s` |
| 6 | `focus-tightening` | Applets you are not using are measured against a smaller budget | Background windows spending a foreground budget. Refused before dispatch: kernl's rate limiter counts an unfocused window at `unfocusedMultiplier` of capacity as each envelope arrives and drops one over it with a guard event (`rate:<class>`). kehto's runtime applies the same multiplier, with the focus kernl reports through `getFocusContext`, to what it carries out, including held envelopes released while the window is unfocused. Once the window is focused, the full budget applies again. Focus is observed by the shell, never self-reported. | `both` | `25% of the focused budget` |
| 7 | `hidden-deferral` | Hidden applets cannot act until you can see them | Hidden or minimised applets acting where the user cannot see them. While a window is not visible, every non-control port envelope is held (`hidden:<class>`, a `defer` event), up to `deferQueue`; past it, it is dropped (`defer:queue-full`). When the window is visible again kernl calls `releaseDeferred` and kehto handles what it held, in order. Control envelopes are answered, unless the window already holds a request, in which case kehto queues them behind it. Each `resource.*` request from a hidden window counts against `hiddenResourceAllowance` as it arrives; the one past it quarantines the window (`flood:hidden-resource`): the binding is revoked inside the filter, so that request is not dispatched, what the window held is discarded, and the frame is removed. Quarantine is checked first, so a request past the allowance quarantines rather than being held. | `kernl` | `8 downloads while hidden` |
| 8 | `ingress-flood` | Applets that flood the shell are put in quarantine | A busy loop starving the shell's main thread. Per-window token bucket, counted as each port envelope arrives: non-control envelopes in a burst above `ingressBurst` are dropped before dispatch (`flood:burst`, `flood:queue-full`) and are not queued; control envelopes still pass. The message that reaches `quarantineThreshold` in 10 s quarantines the window: the binding is revoked inside the filter, so that message is not dispatched, and the frame is removed. Only the window-level `hello` is ever queued by this layer. | `kernl` | `8 messages per second, 300 per 10s` |
| 9 | `size-caps` | Oversized requests are refused | Memory pressure from oversized filters or payloads. The ingress guard measures `resource.*` and `relay.subscribe`/`outbox.subscribe` envelopes as they arrive and rejects an oversized one with `size:<class>`. kehto's runtime cannot measure these itself (it sizes only an envelope's `event`), so kernl's filter drops the envelope. Nothing is fetched, the applet gets no reply, and the user sees the guard event. An oversized `hello` is dropped. | `kernl` | `downloads 64 KiB, queries 256 KiB` |
| 10 | `firewall` | The firewall decides what an applet may ask for | A request going ahead that the user would have wanted a say in. kehto's firewall admits an applet before its code runs and decides every request a service carries out, under rules the user sets: allow, ask or refuse. The shipped rules allow what was granted and ask about every link opened outside the shell ([The firewall](#the-firewall), [D-056](../decisions.md#d-056)). | `both` | none |
| 11 | `device-denial` | Applets cannot use your camera, microphone or other devices | An applet reaching hardware. `denyNappletControllerAccess` gives the frame the Permissions Policy `gamepad 'none'; hid 'none'; usb 'none'`; the frame's `allow` attribute delegates nothing else, so camera, microphone and other powerful features stay off. There is no grant for any of them. | `kehto` | none |
| 12 | `destructive-consent` | Deleting or overwriting asks you first | An applet acquiring authority the user did not knowingly give. `createSigningConsent` puts a `sign.replace` ask to the person before a destructive kind (every replaceable kind 0, 3, 10000–19999; every addressable kind 30000–39999; 5; 62) is signed for an applet, after looking up the current version in the store and then on the outbox and discovery relays for up to `CURRENT_VERSION_TIMEOUT_MS` (4000 ms); if none is found the summary says "Current version: could not be loaded; this replaces it entirely". It runs on both routes: the window signer from `ShellAdapter.auth.getSigner(windowId)` for `relay.publish`, and kernl's outbox gate for `outbox.publish`. A denial is `denied:consent` and nothing is signed; answers are not remembered, and the shell's own signing is not gated. kehto's runtime has no such step. | `kernl` | none |

`enabled` is `true` for every row in every profile; the field exists for the UI contract. The opaque-origin frame, the CSP and the frame lock are one row (`zero-network-sandbox`), not three. See `mitigations.feature`, scenario "every mitigation is described once, in display order".

## Operation classes

kehto's rate limiter treats the operation class as an opaque key. `classifyEnvelope` gives each inbound envelope one of eleven classes from its `type` and, for publishes, its `kind`:

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
| `relay.close`, `outbox.close`, `storage.get`, `storage.keys`, `shell.*`, `inc.*`, `theme.*`, `identity.*`, `keys.*`, other `dm.*` | `control` |
| anything else (`clipboard.write`, …) | `generic` |

`relay:publish:delete` gives kind 5 deletions their own, tighter budget in kernl's rate limiter, so a burst of deletes is dropped as `rate:relay:publish:delete`. The runtime has no separate delete budget: it charges an operation by the name its service gave it, which does not say what kind a publish carries, so deletions share the `relay:publish` budget there ([Where enforcement happens](#where-enforcement-happens)). What stops an unwanted deletion is signing consent, not the rate. See `classification.feature`.

## Profiles

A profile is a `GuardLimits` record plus the budgets derived from it: one `@kehto/rate-limit` `RateLimitConfig` per operation class, in `GuardConfig.rateLimits`. `createGuardConfig(profile)` builds both. Profiles change limits only. `GUARD_PROFILES` lists them tightest first.

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

Every budget kernl builds has exceed action `block`; kehto's own suggestion is `flag`. Each is scaled by `unfocusedMultiplier` while the window is unfocused, and none carries a startup burst ([Layers](#layers)). The shell boots in `strict`. [Change the guard profile](../how-tos/change-guard-profile.md) shows how a user changes the shell-wide profile; per-applet profiles are planned. See `profiles.feature`.

## Layers

Three stateful objects, each built from the same `GuardConfig`, each keyed by `windowId`, each with a `forget(windowId)` to call on revocation. This section describes each layer's own API. In the composed shell the window-level `hello` gets these dispositions directly; for port traffic the pipeline turns them into kehto's `dispatch`, `defer` or `drop` ([Where enforcement happens](#where-enforcement-happens)).

| Layer | Enforces | Factory |
| --- | --- | --- |
| Ingress guard | `ingressBurst`, `ingressQueue`, `quarantineThreshold`, `hiddenResourceAllowance`, both envelope size caps | `createIngressGuard({ config, now?, onEvent?, drainBatch? })` |
| Visibility gate | `deferQueue`; which classes wait while hidden | `createVisibilityGate({ config, now?, onEvent?, nappletFor? })` |
| Focus-aware rate limiter | `@kehto/rate-limit`'s `evaluateRateLimit`: one budget per operation class, kept per applet, at `unfocusedMultiplier` of capacity while the window is unfocused | `createFocusRateLimiter({ config, now?, onEvent? })` |

**Ingress guard.** Each window has a token bucket of `ingressBurst` per second. While tokens remain, `admit` returns `pass`. When they are spent, or while anything is already queued, the envelope is queued and `admit` returns `defer` with reason `flood:burst`; nothing overtakes the queue. Past `ingressQueue` the envelope is rejected with `flood:queue-full`. With `admit(..., { hold: false })`, which the pipeline uses for port traffic it refuses rather than holds, a spent burst still returns `defer` with `flood:burst` but nothing is queued. `drain(windowId)` releases at most `drainBatch` (default 4) queued envelopes, never more than the refilled tokens allow, ordered `control` first, then `resource:bytes`, then everything else, oldest first within a rank. Arrivals are counted over a rolling `QUARANTINE_WINDOW_MS` (10 s); the arrival that reaches `quarantineThreshold` quarantines the window with `flood:quarantine`, drops its queue, and every later envelope returns `quarantine` with the same reason until `release(windowId)` (fresh budget, quarantine lifted) or `forget(windowId)`. While a window is hidden, each `resource:bytes` envelope counts against `hiddenResourceAllowance`; the one past it quarantines with `flood:hidden-resource`. Any admission while visible resets that count. An envelope whose class has a size cap and whose `size` exceeds it is rejected with `size:<class>`; an envelope without a `size` is not size-checked. A clock that runs backwards grants no tokens. See `ingress.feature`.

**Visibility gate.** The shell reports visibility with `setVisibility`; a window it has not reported on counts as visible and unfocused. `shouldDefer(windowId, opClass)` is true when the window is hidden and the class is not `control`, so a hidden window can still be closed, themed or asked for its identity. `defer` queues up to `deferQueue` envelopes and then returns `false` while emitting a `reject` event with reason `defer:queue-full`; the event names the applet through `nappletFor`, or `unknown` without one. `drain` returns every held envelope oldest first and empties the queue. Deferral is a privacy and resource measure, not a rate limit: a minimised applet should not fetch or publish while the user cannot see it. See `visibility.feature`.

**Focus-aware rate limiter.** `observe` classifies the envelope and charges it against `config.rateLimits[class]` with kehto's pure `evaluateRateLimit`, with the applet as the subject and the `focused` flag from the shell's `WindowVisibility`. Budgets are kept per applet (`dTag`) and class, so two windows of the same applet share a budget (`focus-rate-limit.feature`, scenario "budgets are per applet, not per window"). It returns a `RateVerdict`, `{ decision: 'pass' | 'reject', action, reason }`. A spent budget whose action is `block` rejects and emits `reject`; one whose action is `flag` passes and emits `flag`. The event reason is `rate:<class>`, so the user sees what ran out. This layer is temporal only. It has no allow, ask or deny policies and no content matchers: whether an applet may do something at all is decided by its grants and by the [firewall](#the-firewall), and size caps are the ingress guard's. `forget(windowId)` drops the budgets of every applet seen in that window, which also resets the budget of another window running the same applet; revocation is user-driven, so that is accepted.

**No startup burst.** kehto's rate limiter can also refuse a burst in a window's first moments. kernl configures none, in its own limiter or in the one it hands the runtime: the ingress guard counts `ingressBurst` in every second of a window's life, its first included, and the runtime would count a first second from when the window was planned, not from when it ran ([D-056](../decisions.md#d-056)).

## Where enforcement happens

kehto's bridge owns the `MessagePort` an applet speaks over. For each envelope on it, kehto asks the host's `ShellAdapter.filterNappletMessage` before the runtime sees it, and follows the answer: `dispatch`, `drop` (nothing is handled and nothing is sent back) or `defer` (held until `ShellBridge.releaseDeferred(windowId)`). `shell.ready` never reaches the filter. Enforcement is layered ([D-020](../decisions.md#d-020)):

| Traffic | Where | How |
| --- | --- | --- |
| The window-level `napplet.hello` | kernl, before kehto sees it | `Kernl.handleWindowMessage` resolves the sending window from `originRegistry`, never from the message, and runs ingress guard → visibility gate → rate limiter before `bridge.handleMessage`. Any other window-level message from a bound applet is kehto's `window-message` revocation. |
| Port traffic, decided | kernl, inside `filterNappletMessage` | `GuardPipeline.observe` runs the ingress guard, the hidden-window check and the rate limiter and answers kehto. Before any of that it looks at shortcuts ([D-054](../decisions.md#d-054)): a `keys.forward` that is a held key repeating, or that comes from a window that is not focused, is dropped uncounted and unreported, and a `keys.registerAction` or `keys.unregisterAction` in a window's first second is answered `defer` and released when that second is over. `dispatch` for an envelope within budget and for control envelopes. `drop` for `size:<class>`, `flood:burst`, `flood:queue-full`, the focus firewall's `rate:<class>`, and `defer:queue-full`. `defer` for a non-control envelope from a window that is not visible (`hidden:<class>`). A `quarantine` calls `onQuarantine`, which marks the handle revoked with reason `quarantine` and calls `bridge.revokeNapplet(windowId, 'host')` inside the filter; kehto then drops the envelope and discards what the window held, and the frame is removed. |
| Port traffic, released | kehto, when kernl asks | When a window becomes visible the pipeline calls `onRelease`, and `createKernl` calls `bridge.releaseDeferred(windowId)`. kehto dispatches the held envelopes in arrival order without asking the filter again; the ACL, the firewall and the runtime's rate limiter check each one, at the window's focus then. A window holding more than kehto's `MAX_DEFERRED_MESSAGES` (1024) is revoked with `deferred-overflow`; kernl's `deferQueue` is smaller, so it drops first, and the frame is removed on that reason as on every other. |
| Port traffic, refused by rate | kehto's runtime, with the limiter kernl hands it | `createRuntimeRateLimiter(() => pipeline.config)` is `permissions.rateLimiter`. The runtime charges what it is about to carry out: each request a service puts to the firewall, and the storage, settings and applet-to-applet traffic it serves itself. The configuration is read on every charge, so a profile change applies at once and counters carry over. A request over its budget is refused, with `rate limit exceeded` where the protocol has an answer, and reported through `permissions.onRateLimit`, which kernl turns into a guard event with `toGuardEvent`. The report names the window and the operation and carries nothing the applet sent. Where kehto only observes, because a protocol has no way to refuse, a spent budget flags and never blocks. |
| Every request, allowed, asked about or refused | kehto's firewall, under kernl's rules | `createFirewallPermissions` is `ShellAdapter.permissions`. `kernl.plan` has the applet admitted before a plan exists, and each request a service carries out is decided by a stored answer or else by the rules ([The firewall](#the-firewall)). |

The runtime names an operation the way its service does, which for an applet's request is the envelope type, so `runtimeOpClass(operation)` is `classifyEnvelope({ type: operation })` and the guard's classes apply to both counts. Two things differ in the runtime's count. It does not see a publish's kind, so deletions spend `relay:publish`. And a download is charged once, as `resource.bytes`: kehto names a second operation, `resource.network`, for the server the download contacts, and kernl charges nothing for it.

One limit of this arrangement is stated plainly: a dropped request gets no reply, because NAP defines no answer for a request the host drops, so an applet has to time out. kernl's own layers report everything they decide, so the guard log does not depend on the runtime's reports.

## Dispositions and reasons

`IngressGuard.admit()` returns one of four dispositions:

| Disposition | Meaning | For the window-level `hello` | For port traffic (kehto's decision) |
| --- | --- | --- | --- |
| `pass` | Within budget. | Forwarded to the bridge after the visibility gate and the rate limiter. | `dispatch`, or `defer` when the window is not visible and the envelope is not control. |
| `defer` | The per-second burst is spent; the envelope is queued. | Held; `drainAll` forwards it as tokens refill. | `drop`, with a `flood:burst` event; the envelope is not queued. Control envelopes are dispatched. |
| `reject` | The queue is full or the envelope is over its size cap. | Dropped. | `drop`, with `flood:queue-full`, `size:<class>`, `rate:<class>` from the rate limiter, or `defer:queue-full` for a hidden window past `deferQueue`. Control envelopes are dispatched. |
| `quarantine` | The window hit the quarantine threshold or the hidden resource allowance, or is still quarantined. | Dropped, and the window is revoked. | `drop`; `onQuarantine` revokes the binding inside the filter, so this envelope is not dispatched, what the window held is discarded, and the frame is removed. |

Every disposition other than `pass`, and every `pass` the rate limiter flagged, emits a `GuardEvent` with a stable prefixed reason. The user sees these events; secrets never appear in them.

| Reason | Emitted by | With disposition |
| --- | --- | --- |
| `flood:burst` | ingress guard | `defer` |
| `flood:queue-full` | ingress guard | `reject` |
| `flood:quarantine` | ingress guard | `quarantine` |
| `flood:hidden-resource` | ingress guard | `quarantine` |
| `size:<class>` (`size:resource:bytes`, `size:relay:subscribe`, `size:outbox:subscribe`) | ingress guard | `reject` |
| `defer:queue-full` | visibility gate | `reject` |
| `hidden:<class>`, a non-control port envelope from a window that is not visible, held until it is | guard pipeline (`observe`) | `defer` |
| `rate:<class>` | focus-aware rate limiter | `reject`, or `flag` when the budget's action is `flag` |
| `rate:<class>`, the runtime's own refusal of a request it was about to carry out | kehto's runtime, through `permissions.onRateLimit` | `reject`, or `flag` where kehto only observes |
| `flood:prompts`, a firewall question not put to the user because the applet asked too often | kehto's runtime, through `permissions.onRateLimit` | `reject` |

`flood:startup`, `runtime:<ruleId>`, `matcher:<id>`, `policy:deny` and `prompt:<ruleId>` came from the rate engine kernl ran before [D-056](../decisions.md#d-056) and no longer occur.

## The firewall

The firewall is kehto's (`@kehto/firewall`), and it is approval, not rate limiting. [Grants](./identity-and-grants.md) decide which domains an applet holds. The firewall decides, inside those, what goes ahead without asking, what asks the user, and what is refused ([D-056](../decisions.md#d-056)). kernl configures it through `ShellAdapter.permissions` and gives it rules, so the user is not asked about every request. The ACL stays restrictive, and under `permissions` it is a ceiling: no firewall answer gives an applet more than its grant.

**The shipped rules.** `defaultFirewallRules()` allows everything and asks about `link.open`. Starting an applet asks nothing, because the grant already answered for each domain. Opening a link outside the shell asks every time: the question offers "Open link" and "Don't open", and the answer is never kept. The preview runs the same rules.

**Rules.** A rule is `allow`, `ask` or `deny`, for everything, for one domain or for one request, and for every applet or for one. The most specific rule wins: the applet's rule for the request, for its domain, the applet's default, then the same three for every applet. A request with several requirements is refused when any is denied, asks when any asks, and goes ahead without asking only when every one is allowed. Rules are keyed by an applet's catalogue id, so they follow it across versions, and are kept under `kernl:firewall-rules:v1`. A damaged rules document falls back to the shipped rules.

**Starting an applet.** `kernl.plan` puts the start to the firewall before a plan exists, for every domain the grants leave the applet except `shell`. The domains the applet requires are decided together, and a refusal refuses the start with `denied:firewall`. Each other domain is decided on its own and is left out of the plan's environment when refused. `mount` throws `denied:admission-expired` when an answer the plan relied on was taken back since, or when the plan was the oldest of more than `MAX_UNMOUNTED_PLANS` (16) left unmounted.

**Questions.** A request a rule says to ask about reaches the host as a `firewall.approve` ask ([Asks](./asks.md)). A host that draws none has such a request refused, never allowed. A question nobody answers is withdrawn after `FIREWALL_PROMPT_TIMEOUT_MS` (ten minutes), or when the applet closes. An applet that asks more often than kehto's suggested budget (twelve questions a minute, eight in a window's first three seconds) has the rest dropped, with a `flood:prompts` guard event.

**Answers.** For anything but a link, the user can allow once, allow while the applet stays open, allow always, or refuse; an applet that is starting is not offered "once", because a start is admitted for the whole run. Only "always" answers are stored, under `kernl:firewall-decisions:v1`, and they are tied to the exact code that asked, so a new version asks again. If the stored answers are damaged, every start is refused with `unavailable:firewall` until the user clears them, and the shell says so.

**Taking an answer back.** `kernl.firewall.forget(id)` takes one answer back and `forgetAll()` all of them; tightening a rule takes back the answers the old rule gave. kehto ends the work the answer covered, and kernl removes the window's frame with reason `firewall`, as it does for a narrowed grant ([D-038](../decisions.md#d-038)).

Three gaps are recorded next to the code. Only a download's first origin reaches the firewall, because the bridge registry follows redirects under its own address policy. The relay plan for messages and social actions names every relay in the shell's tiers, not the recipient's inboxes. An upload's plan names the first file server, not its mirrors.

[Change the firewall rules](../how-tos/change-firewall-rules.md) shows how a user and a host change the rules.
## Why CSP never loosens

The three profiles scale rates and queues. None of them touches the Content Security Policy. A profile is a statement about how much an applet may do through the shell; the CSP is a statement about whether an applet may bypass the shell at all. Loosening a rate limit lets a trusted applet work faster. Loosening the CSP would let it talk to the network directly, which removes the shell's ability to see, rate-limit and revoke that traffic and so removes every other mitigation on this page at once.

`createAppletCsp(profile)` therefore accepts the profile, so that callers configure one place, and ignores it. It returns `connectOrigins: []` and kehto's zero-network baseline of 14 directives, which `renderCsp` serialises as:

```
default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'
```

An applet that needs a network resource asks the `resource` domain, and the request goes through a [bridge](./bridges.md). See `csp.feature`, scenario "the relaxed profile does not loosen the CSP".

## No network path

`zero-network-sandbox` has three parts: the CSP, kehto's prelude, and the frame lock (kehto's nested-context lock plus kernl's insertion lock).

**kehto's prelude.** `prepareNappletSrcdoc` puts it in the frame right after the CSP `<meta>`, so it runs before any applet code. Before it opens the port to the shell, the prelude takes every global whose name starts with `RTC`, plus `webkitRTCPeerConnection`, `mozRTCPeerConnection`, `webkitRTCSessionDescription`, `mozRTCSessionDescription`, `webkitRTCIceCandidate` and `mozRTCIceCandidate`, and redefines each as `undefined`, read-only, non-configurable and non-enumerable. The names still exist, but no value can be put back: `delete` and assignment leave them `undefined`. A peer connection would otherwise be a way out the CSP does not cover.

**The frame lock** ([D-014](../decisions.md#d-014)). The prelude cleans only the applet's own realm. A child frame made from `srcdoc` or `about:blank` is a fresh realm with a working `RTCPeerConnection`, and no CSP directive reaches it, because creating it involves no fetch. `planMount` closes this for every applet in two layers:

- **kehto's nested-context lock.** `planMount` passes `experimental: { nestedContextLock: true }` to `prepareNappletSrcdoc` (`@kehto/shell` 0.30.0). kehto then adds `require-trusted-types-for 'script'; trusted-types default` to the CSP `<meta>` it renders, so every string sink goes through one `default` policy and no other policy name can be registered. Its prelude installs that policy, which refuses frame markup at every HTML string sink (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `createContextualFragment`, `DOMParser`), and pins `Document.prototype.createElement`, `createElementNS` and `DOMImplementation.prototype.createDocument` non-configurable so they refuse a frame tag name. Both throw `TypeError: kehto: napplets may not create nested browsing contexts`. Before any of this, `planMount` runs kehto's `assertNappletHasNoFrame` on the verified bytes and refuses markup that contains an `iframe`, `frame`, `frameset`, `object`, `embed`, `portal` or `fencedframe` element with `denied:nested-frame`.
- **kernl's insertion lock.** kehto's lock guards creation only, and creation routes are open-ended: a customized built-in constructed with `new`, XSLT, and namespace-prefixed XHTML parsing (which kehto's string-sink pattern does not match) all mint frames without a factory. A frame gets a realm only when it is connected, so `renderInsertionLockScript()` emits `<script data-kernl-insertion-lock>`, which `planMount` inserts immediately after kehto's prelude, before any applet script. It runs `appletInsertionLock`, which pins every DOM insertion method (`appendChild`, `insertBefore`, `replaceChild`, `append`, `prepend`, `replaceChildren`, `before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `Range.insertNode`, `Range.surroundContents`) to throw `TypeError: denied:nested-frame` for a node that is, or contains, a frame element, reading node identity through native getters captured before applet code runs. It also refuses custom elements that extend frame elements and removes `XSLTProcessor`. Every insertion therefore walks the inserted subtree once. When kehto's CSP meta and prelude are not where `planMount` expects them, the mount is refused with `unavailable:frame-lock`. The four routes are to be reported to kehto, and the insertion lock goes once kehto guards insertion.

**The CSP** refuses everything else: `fetch` and WebSocket by `connect-src 'none'`, images by `img-src data: blob:`, frames that would load a URL by `frame-src 'none'` and `child-src 'none'`, and beacons by `connect-src`. `navigator.sendBeacon` still returns `true`, because it only reports that the beacon was queued; the request is refused when the browser sends it, and fails with `csp`.

`tests/e2e/applet-network-sealed.spec.ts` proves this in Chromium. It builds an applet frame with kernl's own `planMount` (`sandbox="allow-scripts"`, a host page carrying `KERNL_FRAME_POLICY_META`) and checks that kehto's CSP carries the Trusted Types directives and that kernl's insertion lock follows kehto's prelude and precedes the applet's script. The applet code then tries each way out, and the spec asserts:

- each of 15 frame-creation routes, plus `document.write` whole and split across calls, throws a `TypeError` (kehto's message at a factory or string sink, `denied:nested-frame` at an insertion); the four creation routes the factories cannot see (a customized built-in constructed with `new`, XSLT, and a namespace-prefixed XHTML element brought in with `importNode` or `adoptNode`) fail at creation or at insertion; and thirteen insertion routes (every pinned method, a shadow root, a fragment) refuse an unconnected frame;
- no child realm exists, no `RTC*` constructor is usable in the applet's realm, and no realm produces a `srflx` or `relay` ICE candidate. As a control, when the host page can reach a public STUN server, the spec asserts that it does and that the applet produces no such candidate; when it cannot, the control is skipped;
- `fetch` fails, the WebSocket never opens, every `RTC*` global is pinned to `undefined` and cannot be restored, the image does not load, the browser reports a CSP violation for each attempt including the beacon, and no request reaches the network layer: every outbound request fails with `csp`.

[D-014](../decisions.md#d-014) records the negative control: the same probe run against a srcdoc built by `@kehto/shell` 0.29.0 alone, without the lock, lets 11 routes escape, each producing a child realm that reports `host` and `srflx` candidates.

## What the guard is not

It is not an access control list. Whether an applet may use a domain is a grant, described in [Identity and grants](./identity-and-grants.md). The guard assumes the grant exists and asks a different question: is this applet abusing what it was granted, right now?

## Related

- [`@kernlize/guard`](../packages/guard.md)
- [Change the guard profile](../how-tos/change-guard-profile.md)
- [Change the firewall rules](../how-tos/change-firewall-rules.md)
- [Applets under kernl](./applets-under-kernl.md)
