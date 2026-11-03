# Guard

The guard is everything that stands between an applet and the user. Some of it is kehto's and kernl turns it on; some of it is kernl's and runs in front of kehto's bridge. The user sees it as one list of mitigations with reasons. This page is that list, with the numbers.

The rule from `SOUL.md`: if kehto ships a mitigation, kernl enables it by default and documents how to loosen it. Loosening is done by the user, never by a developer flag ([D-003](../decisions.md#d-003)). In this draft the profile is shell-wide and resets to `strict` on every boot; per-applet profiles are planned ([Roadmap](../roadmap.md#_6-guard)).

**What runs before dispatch and what only watches.** For an applet's port traffic, which is everything after the handshake, the only limits enforced before kehto dispatches an envelope are kehto's runtime firewall rates, which kernl installs at mount ([Where enforcement happens](#where-enforcement-happens)). kernl's ingress guard and focus firewall see the same envelopes after dispatch: they record guard events and quarantine (revoke the binding) on floods, but they do not hold, drop or size-cap a port envelope. The visibility gate holds only the window-level `hello`. Signing consent is a third path, in the signer itself.

## The eleven mitigations

`describeMitigations(config)` in `@kernl/guard` returns this list as `MitigationDescription[]`, in this order, with the `limit` text computed from the profile in `config`. The shell renders it verbatim; the titles below are the ones the user sees, and they carry no protocol vocabulary. The third column is for developers and does.

| # | `id` | Title shown to the user | What it protects against | `provider` | `limit` in `strict` |
| --- | --- | --- | --- | --- | --- |
| 1 | `zero-network-sandbox` | Applets cannot reach the network on their own | Exfiltration, tracking pixels, loading code the user did not verify. The frame loads through `srcdoc` with `sandbox="allow-scripts"` and the CSP below; every byte from the network arrives through a shell service. | `kehto` | none |
| 2 | `bound-identity` | An applet is only trusted while its connection and code match | A reloaded or substituted document inheriting grants. Identity is `(dTag, artifactHash)` plus the one `MessagePort` transferred in `napplet.hello`. | `kehto` | none |
| 3 | `verified-artifacts` | Applet code is verified before it runs, and again before reuse | A gateway or cache serving different code than the signed manifest names. Bytes are fetched by hash through `@kehto/nip/5d`, cached only after verification and re-verified on every read. | `kehto` | none |
| 4 | `replay-detection` | Replayed messages are dropped | One frame speaking for another; replaying a handshake. A window-level message, a second `hello`, a `hello` without exactly one port, a second load or a closed port revokes the binding. | `kehto` | none |
| 5 | `rate-limits` | Applets have a budget for how often they can act | Publishing, subscribing or spending quota at a rate no human interaction explains. Enforced before dispatch: kehto's runtime firewall refuses over-budget envelopes using the per-class rates kernl installs at mount, where deletions count against `relay:write`. After dispatch, kernl's focus firewall counts the same classes again, including a separate `relay:publish:delete` bucket, and reports overruns as `rate:<class>` events. | `both` | `publish 20 per 60s, delete 5 per 60s, messages 20 per 60s` |
| 6 | `focus-tightening` | Applets you are not using are measured against a smaller budget | Background windows spending a foreground budget. Reported after dispatch: kernl's focus firewall counts an unfocused window at `unfocusedMultiplier` of capacity and emits a guard event when it goes over; it does not refuse. Focus is observed by the shell, never self-reported. Before dispatch the runtime applies kehto's default multiplier, because it has no setter for kernl's. | `kernl` | `25% of the focused budget` |
| 7 | `hidden-deferral` | Hidden applets that keep downloading are stopped | Hidden or minimised applets consuming network budget the user cannot see. After dispatch, each `resource.*` request from a hidden window counts against `hiddenResourceAllowance`; the one past it quarantines the window (`flood:hidden-resource`), which revokes its binding. Other port traffic from a hidden window is recorded, not held. The visibility gate holds only a hidden window's window-level `hello`. | `kernl` | `8 downloads while hidden` |
| 8 | `ingress-flood` | Applets that flood the shell are put in quarantine | A busy loop starving the shell's main thread. Per-window token bucket, observed after dispatch for port traffic: bursts above `ingressBurst` are reported (`flood:burst`, `flood:queue-full`), and crossing `quarantineThreshold` in 10 s quarantines the window, which revokes its binding. Only the window-level `hello` is actually queued or rejected. | `kernl` | `8 messages per second, 300 per 10s` |
| 9 | `size-caps` | Oversized requests are reported | Memory pressure from oversized filters or payloads. `resource.*` and `relay.subscribe`/`outbox.subscribe` envelopes are measured after dispatch, by the ingress guard (`size:<class>`) and kehto's content matchers in the focus firewall (`matcher:size:<class>`), and an oversized one is reported as a guard event; it is not stopped. Only an oversized `hello` is rejected. | `kernl` | `downloads 64 KiB, queries 256 KiB` |
| 10 | `device-denial` | Applets cannot use your camera, microphone or other devices | An applet reaching hardware or a controller the shell registered. Device and controller access is refused for every applet; there is no grant for it. | `kehto` | none |
| 11 | `destructive-consent` | Deleting or overwriting asks you first | An applet acquiring authority the user did not knowingly give. `createSigningConsent` asks `host.presentConsent` before a destructive kind (0, 3, 5, 10002 and the list kinds) is signed for an applet, on both routes: the window signer from `ShellAdapter.auth.getSigner(windowId)` for `relay.publish`, and kernl's outbox gate for `outbox.publish`. A denial is `denied:consent` and nothing is signed. kehto's runtime has no such step. | `kernl` | none |

`enabled` is `true` for every row in every profile; the field exists for the UI contract. Two things the old shape of this list claimed are not separate mitigations: the opaque-origin frame and the CSP are one row (`zero-network-sandbox`), and kehto's init-burst guard is not a row at all, for the reason given under [Layers](#layers). See `mitigations.feature`, scenario "every mitigation is described once, in display order".

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

`relay:publish:delete` gives kind 5 deletions their own, tighter bucket in kernl's reactive focus firewall, so a burst of deletes is reported as `rate:relay:publish:delete`. Before dispatch there is no separate delete bucket: kehto's runtime firewall keys by capability, and deletions share the `relay:write` budget with other publishes ([translation table](#where-enforcement-happens)). What stops an unwanted deletion is signing consent, not the rate. See `classification.feature`.

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

Three stateful objects, each built from the same `GuardConfig`, each keyed by `windowId`, each with a `forget(windowId)` to call on revocation. This section describes each layer's own API, which is what a caller that sits in front of dispatch gets. In the composed shell that is true only for the window-level `hello`; for port traffic the dispositions below become events and, for `quarantine`, a revocation ([Where enforcement happens](#where-enforcement-happens)).

| Layer | Enforces | Factory |
| --- | --- | --- |
| Ingress guard | `ingressBurst`, `ingressQueue`, `quarantineThreshold`, `hiddenResourceAllowance`, both envelope size caps | `createIngressGuard({ config, now?, onEvent?, drainBatch? })` |
| Visibility gate | `deferQueue`; which classes wait while hidden | `createVisibilityGate({ config, now?, onEvent?, nappletFor? })` |
| Focus firewall | kehto `evaluate()`: per-applet class rates, the `generic` default rate, the content matchers, `unfocusedMultiplier`, per-applet policies | `createFocusFirewall({ config, now?, onEvent? })` |

**Ingress guard.** Each window has a token bucket of `ingressBurst` per second. While tokens remain, `admit` returns `pass`. When they are spent, or while anything is already queued, the envelope is queued and `admit` returns `defer` with reason `flood:burst`; nothing overtakes the queue. Past `ingressQueue` the envelope is rejected with `flood:queue-full`. `drain(windowId)` releases at most `drainBatch` (default 4) queued envelopes, never more than the refilled tokens allow, ordered `control` first, then `resource:bytes`, then everything else, oldest first within a rank. Arrivals are counted over a rolling `QUARANTINE_WINDOW_MS` (10 s); the arrival that reaches `quarantineThreshold` quarantines the window with `flood:quarantine`, drops its queue, and every later envelope returns `quarantine` with the same reason until `release(windowId)` (fresh budget, quarantine lifted) or `forget(windowId)`. While a window is hidden, each `resource:bytes` envelope counts against `hiddenResourceAllowance`; the one past it quarantines with `flood:hidden-resource`. Any admission while visible resets that count. An envelope whose class has a size cap and whose `size` exceeds it is rejected with `size:<class>`; an envelope without a `size` is not size-checked. A clock that runs backwards grants no tokens. See `ingress.feature`.

**Visibility gate.** The shell reports visibility with `setVisibility`; a window it has not reported on counts as visible and unfocused. `shouldDefer(windowId, opClass)` is true when the window is hidden and the class is not `control`, so a hidden window can still be closed, themed or asked for its identity. `defer` queues up to `deferQueue` envelopes and then returns `false` while emitting a `reject` event with reason `defer:queue-full`; the event names the applet through `nappletFor`, or `unknown` without one. `drain` returns every held envelope oldest first and empties the queue. Deferral is a privacy and resource measure, not a rate limit: a minimised applet should not fetch or publish while the user cannot see it. See `visibility.feature`.

**Focus firewall.** `observe` builds a kehto `Observation` from the envelope and the shell's `WindowVisibility` (`focused`, and `msSinceFocusGain` when known) and runs `evaluate()`. On the first observation of an applet it calls `applyNappletRules` so the applet's class rates exist in kehto's per-applet map; kehto keys those budgets by applet (`dTag`), so two windows of the same applet share a budget (`focus-firewall.feature`, scenario "budgets are per applet, not per window"). Decisions map to events: `reject` emits `reject`; `pass` with action `flag` emits `flag`; `prompt` emits `reject` with reason `prompt:<ruleId>`. kernl treats a prompt as a denial here because the layer has no UI; signing consent for destructive writes is a separate path, in the signer wrapper, not in the firewall. kehto's `rate:*` rule ids name the tier (`rate:opclass`, `rate:global`, `rate:default`); the event reason is rewritten to `rate:<class>` so the user sees what ran out. Other rule ids pass through unchanged, for example `matcher:size:resource:bytes` and `policy:deny`. `forget(windowId)` drops the buckets of every applet seen in that window, which also resets the budget of another window running the same applet; revocation is user-driven, so that is accepted.

**What `burstGuard` is for.** `createGuardConfig` sets `firewall.burstGuard` to `{ windowMs: 1000, maxOps: ingressBurst, action: 'block' }`. kehto's init-burst guard only fires for callers that supply `initElapsedMs` in the observation; the focus firewall never does, so inside kernl the per-second burst is enforced by the ingress guard alone. The field exists so that a runtime firewall configured from this object agrees with the ingress guard, and it is why there is no separate "init-burst guard" row in the mitigation list.

## Where enforcement happens

kehto's bridge owns the `MessagePort` an applet speaks over and shows the host that traffic only through the observe-only `ShellAdapter.onNappletMessage` hook, so kernl cannot sit between the port and the runtime ([D-001](../decisions.md#d-001)). Enforcement is therefore layered ([D-012](../decisions.md#d-012)):

| Traffic | Where | How |
| --- | --- | --- |
| The window-level `napplet.hello` | kernl, before kehto sees it | `Kernl.handleWindowMessage` resolves the sending window from `originRegistry`, never from the message, and runs ingress guard → visibility gate → focus firewall before `bridge.handleMessage`. This is the one message the pipeline can hold or drop; any other window-level message from a bound applet is kehto's `window-message` revocation. |
| Port traffic, before dispatch | kehto's runtime firewall, configured by kernl | `kernl.mount` calls `applyRuntimeFirewallRules(bridge.runtime.firewallState, config, dTag)`, which installs the profile's per-class rates for that applet with policy `allow`. The runtime refuses over-budget envelopes itself. |
| Port traffic, after dispatch | kernl, reactive | `onNappletMessage` feeds `GuardPipeline.observe`: the ingress guard and the focus firewall advance their counters and emit events; a `quarantine` disposition calls `onQuarantine`, which marks the handle revoked with reason `quarantine` and calls `bridge.revokeNapplet(windowId, 'host')`. Nothing can be held or dropped here. |

The runtime keys its rates by the sender capability a message needs, while the guard classifies by what a message does. `RUNTIME_OP_CLASSES` translates:

| Guard class | Runtime key |
| --- | --- |
| `relay:subscribe` | `relay:read` |
| `relay:publish` | `relay:write` |
| `relay:publish:delete` | none; deletions share `relay:write` before dispatch and keep their own bucket only in the reactive layer |
| `outbox:subscribe` | `outbox:read` |
| `outbox:publish` | `outbox:write` |
| `resource:bytes` | `resource:fetch` |
| `storage:write` | `state:write` |
| `dm:send` | `dm:write` |
| `intent:invoke` | `intent:write` |
| `control` | none; control envelopes need no capability |
| `generic` | the per-applet global rate (`setGlobalRate`) |

Two limits of this arrangement are stated plainly. `FirewallStateContainer` has no setter for `unfocusedMultiplier`, so the runtime firewall applies kehto's default multiplier before dispatch and the profile's value (`0.25` in `strict`) only in the reactive focus firewall. And hidden-window deferral is advisory for port traffic in this draft: the visibility gate holds only window-level messages, and by the time `observe` sees a port envelope the runtime has already dispatched it, so for a hidden window the gate's effect is the tightened budget, the hidden-resource allowance that still quarantines, and the event trail, not a held queue. Both are recorded as upstream gaps in [Alpha status](../alpha-status.md#upstream-gaps).

## Dispositions and reasons

`IngressGuard.admit()` returns one of four dispositions:

| Disposition | Meaning | For the window-level `hello` | For port traffic (after dispatch) |
| --- | --- | --- | --- |
| `pass` | Within budget. | Forwarded to the bridge after the visibility gate and the focus firewall. | Nothing; the envelope was already dispatched. |
| `defer` | The per-second burst is spent; the envelope is queued. | Held; `drainAll` forwards it as tokens refill. | A `flood:burst` event. Nothing is held. |
| `reject` | The queue is full or the envelope is over its size cap. | Dropped. | A `flood:queue-full` or `size:<class>` event. Nothing is dropped. |
| `quarantine` | The window hit the quarantine threshold or the hidden resource allowance, or is still quarantined. | Dropped, and the window is revoked. | `onQuarantine` revokes the binding and removes the frame. |

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
| `matcher:<id>` (`matcher:size:resource:bytes`, …), kehto's rule id passed through | focus firewall | `reject` |
| `policy:deny` | focus firewall | `reject` |
| `prompt:<ruleId>` (`prompt:policy:ask`) | focus firewall | `reject` |

## Why CSP never loosens

The three profiles scale rates and queues. None of them touches the Content Security Policy. A profile is a statement about how much an applet may do through the shell; the CSP is a statement about whether an applet may bypass the shell at all. Loosening a rate limit lets a trusted applet work faster. Loosening the CSP would let it talk to the network directly, which removes the shell's ability to see, rate-limit and revoke that traffic and so removes every other mitigation on this page at once.

`createAppletCsp(profile)` therefore accepts the profile, so that callers configure one place, and ignores it. It returns `connectOrigins: []` and kehto's zero-network baseline of 14 directives, which `renderCsp` serialises as:

```
default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'
```

An applet that needs a network resource asks the `resource` domain, and the request goes through a [bridge](./bridges.md). See `csp.feature`, scenario "the relaxed profile does not loosen the CSP".

## What the guard is not

It is not an access control list. Whether an applet may use a domain is a grant, described in [Identity and grants](./identity-and-grants.md). The guard assumes the grant exists and asks a different question: is this applet abusing what it was granted, right now?

## Related

- [`@kernl/guard`](../packages/guard.md)
- [Change the guard profile](../how-tos/change-guard-profile.md)
- [Applets under kernl](./applets-under-kernl.md)
