# Guard

The guard is everything that stands between an applet and the user. Some of it is kehto's and kernl turns it on; some of it is kernl's and runs in front of kehto's bridge. The user sees it as one list of mitigations with reasons. This page is that list, with the numbers.

The rule from `SOUL.md`: if kehto ships a mitigation, kernl enables it by default and documents how to loosen it. Loosening is per applet and done by the user, never globally and never by a developer flag (D-003).

## The eleven mitigations

| # | Mitigation | What it protects against | Provided by |
| --- | --- | --- | --- |
| 1 | **Opaque-origin frame.** Applets load through `srcdoc` into an iframe with `sandbox="allow-scripts"` and `denyNappletControllerAccess`. Never `src`, never `allow-same-origin`. | Reading shell storage, cookies or DOM; impersonating the shell origin. | kehto |
| 2 | **Zero-network CSP.** The injected policy allows no `connect-src`, `img-src`, `script-src` or `frame-src` beyond the document itself and `blob:` media. Every byte from the network arrives through a shell service. | Exfiltration, tracking pixels, loading code the user did not verify. | both: kehto builds and injects, kernl fixes the profile |
| 3 | **Verified artifacts.** Bytes are fetched by hash through `@kehto/nip/5d` `resolveNapplet`, cached only after verification, and re-verified on every read. | A gateway or cache serving different code than the signed manifest names. | kehto |
| 4 | **Identity bound to hash and port.** An applet's identity is `(dTag, artifactHash)` plus the one `MessagePort` it transferred in `napplet.hello`. | A reloaded or substituted document inheriting grants. | kehto |
| 5 | **Replay and cross-window checks.** A window-level message, a second `hello`, a `hello` without exactly one port, a second document load or a closed port revokes the binding. | One frame speaking for another; replaying a handshake. | kehto |
| 6 | **Ingress flood control.** Per-window token bucket on inbound envelopes; excess is queued, then rejected, then quarantined. | A busy loop starving the shell's main thread. | kernl |
| 7 | **Visibility gate.** Hidden and minimised windows have their traffic deferred and their resource requests capped; the queue drains when the window returns. | Background applets consuming relay and network budget the user cannot see. | kernl |
| 8 | **Focus-aware rate limits.** Token buckets per operation class per window, scaled down by a multiplier while unfocused. Focus is observed by the shell, never self-reported. | Publishing, subscribing or spending quota at a rate no human interaction explains. | both: kehto's `evaluate()`, kernl's focus and op classes |
| 9 | **Init-burst guard.** kehto's firewall caps operations inside the initialisation window; kernl tightens it through `bridge.runtime.firewallState`. | An applet firing hundreds of requests before the user has seen it. | kehto |
| 10 | **Envelope size caps.** `resource.*` and `relay.subscribe`/`outbox.subscribe` envelopes above a byte limit are rejected before parsing. | Memory pressure from oversized filters or payloads. | kernl |
| 11 | **Restrictive grants with semantic consent.** Domains are narrowed per identity until granted; writes to kinds 0, 3, 5 and 10002 are shown as what they change, not as JSON. | An applet acquiring authority the user did not knowingly give. | both: kehto's `acl` and `resolveEnvironment`, kernl's `describeChange` |

`describeMitigations(config)` in `@kernl/guard` returns this list as `MitigationDescription[]` with the limit that applies in the current profile. The shell renders it verbatim. Titles there carry no protocol vocabulary; this page does.

## Operation classes

kehto's firewall treats the operation class as an opaque key. kernl gives each inbound envelope one of these classes and keeps a token bucket per class per window:

`relay:subscribe`, `relay:publish`, `relay:publish:delete`, `outbox:subscribe`, `outbox:publish`, `resource:bytes`, `storage:write`, `dm:send`, `intent:invoke`, `control`, `generic`.

`relay:publish:delete` exists so that kind 5 deletions have their own, tighter bucket and their own consent path.

## Profiles

A profile is a `GuardLimits` record plus the derived `FirewallConfig`. Profiles change limits only. Every mitigation is enabled in every profile; `MitigationDescription.enabled` is always `true` in this draft and exists for the UI contract.

| Limit | `strict` (default) | `balanced` | `relaxed` |
| --- | --- | --- | --- |
| `ingressBurst` (messages per second before queueing) | 8 | 1.5–2× strict | 3× strict |
| `ingressQueue` (queued messages before rejection) | 64 | 1.5–2× strict | 3× strict |
| `quarantineThreshold` (messages per 10 s window before quarantine) | 300 | 420 | 800 |
| `hiddenResourceAllowance` (resource requests while hidden) | 8 | 16 | 32 |
| `deferQueue` (deferred messages while hidden before rejection) | 200 | 1.5–2× strict | 3× strict |
| `maxResourceEnvelopeBytes` | 64 KiB | 1.5–2× strict | 3× strict |
| `maxSubscribeEnvelopeBytes` | 256 KiB | 1.5–2× strict | 3× strict |
| `unfocusedMultiplier` (rate capacity while unfocused) | 0.25 | 0.5 | 0.75 |

Where the table says "1.5–2× strict" or "3× strict", read the exact value from `profiles.balanced.limits` or `profiles.relaxed.limits`; the per-class `rates` scale the same way. The shell boots in `strict`. [Change the guard profile](../how-tos/change-guard-profile.md) shows how a user loosens one applet.

## Dispositions and events

`IngressGuard.admit()` returns one of four dispositions:

| Disposition | Meaning | What the shell does |
| --- | --- | --- |
| `pass` | Within budget. | Dispatch to the bridge. |
| `defer` | The window is hidden and this class waits for visibility. | Queue; `drain()` on return. |
| `reject` | Over the queue or envelope limit. | Drop and answer with an error carrying the stable reason. |
| `quarantine` | Over the quarantine threshold. | Drop everything from the window until the user calls `release()`. |

Every disposition other than `pass`, and every `pass` the firewall flagged, emits a `GuardEvent` with a stable prefixed reason such as `rate:relay:publish` or `flood:hidden`. The user sees these events; secrets never appear in them.

## Why CSP never loosens

The three profiles scale rates and queues. None of them touches the Content Security Policy. A profile is a statement about how much an applet may do through the shell; the CSP is a statement about whether an applet may bypass the shell at all. Loosening a rate limit lets a trusted applet work faster. Loosening the CSP would let it talk to the network directly, which removes the shell's ability to see, rate-limit and revoke that traffic and so removes every other mitigation on this page at once. The guard therefore exposes one CSP, built by `cspProfile()`, and no profile, grant or user action changes it. An applet that needs a network resource asks the `resource` domain, and the request goes through a [bridge](./bridges.md).

## What the guard is not

It is not an access control list. Whether an applet may use a domain is a grant, described in [Identity and grants](./identity-and-grants.md). The guard assumes the grant exists and asks a different question: is this applet abusing what it was granted, right now?
