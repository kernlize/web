# Build an applet for kernl

kernl adds nothing to the applet format. An applet that conforms to NIP-5D and the NAPs runs in kernl. What kernl changes is the posture the applet meets: fewer domains until granted, deferral while hidden, limits that tighten when the window loses focus. This page tells you what to expect and how to test for it.

## Use the applet SDK, not this repository

The applet side of the protocol is maintained at [napplet.run](https://napplet.run/docs/). Start there:

- [`@napplet/sdk`](https://www.npmjs.com/package/@napplet/sdk) gives you typed named exports over `window.napplet` for bundler-based projects.
- [`@napplet/conformance`](https://www.npmjs.com/package/@napplet/conformance) is the framework-agnostic conformance engine: a reference mock shell, per-NAP envelope validators, a manifest validator and reporters. `@napplet/conformance-cli` runs it from the command line.
- The [napplet.run getting-started guide](https://napplet.run/docs/guide/getting-started.html) and the [NAP documents](https://github.com/napplet/naps) are the authority on wire format and domain semantics.

kernl's packages are shell-side. You do not import them in an applet.

## What kernl advertises

`shell.ready` tells your applet which domains this shell offers for your identity. In kernl that set is narrowed per applet by the user's grants (see [Identity and grants](../concepts/identity-and-grants.md)), so read it rather than assuming. The draft's intended advertisement:

| Posture | Domains | Notes |
| --- | --- | --- |
| Advertised without a grant | `shell`, `theme`, `config` | Read-only shell state. Always present. |
| Advertised once granted; may appear in `requires` (**R**) | `identity`, `relay`, `outbox`, `keys`, `storage`, `resource`, `lists`, `dm` | The user is asked at mount time for each of these you require. |
| Advertised only when the shell has a backend; optional only (**O**) | `notify`, `media`, `intent`, `link`, `upload` | Never satisfy `requires`. Check `shell.ready` and degrade. |
| Not advertised in this draft | `cvm`, `llm`, `ble`, `webrtc`, `serial`, `fs`, `gamepad`, `inc`, `count` | Requiring one of these means your applet does not mount in kernl. |

Put a domain in `requires` only if your applet is useless without it. Every required domain is one more thing the user must agree to before seeing anything, and a user who declines sees nothing. Prefer `optional` and a graceful fallback.

## What the strict profile means for you

The shell boots every applet in `strict`. The numbers are in [Guard](../concepts/guard.md#profiles); the behaviours you will notice:

**Deferral when hidden.** When your window is minimised or on an inactive workspace, every envelope except `control` traffic (`shell.*`, `theme.*`, `identity.*`, `relay.close`, `storage.get`, …) is held, not dispatched, and released oldest first when the window is visible again. Your `await` resolves late, not with an error. Design for it: do not time out a request after a few seconds, and do not assume a subscription delivers while you are hidden. Up to 200 envelopes are held; the 201st is rejected with `defer:queue-full`.

**Hidden resource allowance.** A hidden window may make 8 `resource.*` requests; the ninth quarantines the window with `flood:hidden-resource` until the user releases it. The count resets as soon as the window is visible again. Fetch what you need while visible.

**Rate limits by operation class.** Each class has its own token bucket, keyed by your applet's `dTag`, so two windows of your applet share one budget. In `strict`: 30 `relay.subscribe` and 20 `relay.publish` per minute, 5 deletions (kind 5) per minute, 20 `dm.send` and 10 `intent.*` per minute, 120 `resource.*` and 60 `storage.set`/`storage.remove` per 10 seconds. While your window is not focused, capacity is multiplied by 0.25. A rejected envelope carries a stable reason such as `rate:relay:publish`.

**Ingress flood control.** Each window may send 8 messages per second; the ninth inside the same second is queued (`flood:burst`) and released as the budget refills, `control` and `resource.*` envelopes first. Once 64 messages are queued, further ones are rejected with `flood:queue-full`; 300 messages inside any rolling 10 seconds quarantines the window with `flood:quarantine` until the user intervenes. Batch your writes and coalesce your subscriptions.

**Envelope caps.** `resource.*` envelopes over 64 KiB and `relay.subscribe`/`outbox.subscribe` (including `outbox.query`) envelopes over 256 KiB are rejected with `size:<class>` before parsing. Large filters are a smell; split them.

**No init-burst exemption.** kehto's own init-burst guard is not what runs here: kernl enforces the same 8 messages per second from the first message your applet sends. Load lazily: request the first screen, render, then fetch the rest.

**Consent for destructive kinds.** Publishing kind 0, 3, 5 or 10002 shows the user a diff of what changes and waits. Expect the publish to take as long as a person takes to read, and expect `denied:` if they refuse.

None of this changes the wire format. A rejection is a normal NAP error envelope with a reason string; a deferral is latency.

## Test against the guard

You can exercise the guard without the full shell. `@kernl/guard` is pure, and the mock shell in `@napplet/conformance` can be wrapped with it:

```ts
import { createGuardConfig, createIngressGuard, createVisibilityGate, type GuardEvent } from '@kernl/guard';

const events: GuardEvent[] = [];
const config = createGuardConfig('strict');
const guard = createIngressGuard({ config, onEvent: (event) => events.push(event) });
const gate = createVisibilityGate({ config, onEvent: (event) => events.push(event) });

gate.setVisibility('w1', { visible: false, focused: false });
if (gate.shouldDefer('w1', 'relay:subscribe')) gate.defer('w1', { type: 'relay.subscribe', size: 512 });
// held; gate.drain('w1') returns it once the window is visible again

gate.setVisibility('w1', { visible: true, focused: true });
for (let i = 0; i < 9; i += 1) {
  guard.admit('w1', 'my-applet', { type: 'relay.publish', kind: 1 }, gate.getVisibility('w1'));
}
// the ninth call inside one second returns 'defer' and emits { disposition: 'defer', reason: 'flood:burst' }
```

Pass `now: () => clock` to both factories to drive time from the test instead of the wall clock. `createFocusFirewall({ config })` adds the per-class rates on top; its `observe()` returns kehto's `EvaluateResult`.

Scenarios worth writing for your own applet:

1. Mount hidden, then show: everything your applet queued while hidden arrives in order and your UI settles.
2. Lose focus mid-operation: your publish still completes, later; nothing is dropped and nothing is retried twice.
3. Hit `rate:*` on purpose: your applet shows the user something useful instead of a stack trace.
4. Be declined: require nothing you cannot explain in the one line the consent prompt shows.
5. New build, old user: your applet's new hash has no grants. Make the first run after an update as good as the first run ever.

## Run it in kernl

Follow [Run the shell](./run-the-shell.md), publish your applet with the napplet tooling to a relay the shell reads, and open it by address. The grants panel shows you exactly which prompt your `requires` produced and every guard event your applet triggered, with its reason. That panel is the fastest feedback you will get on posture.

## Related

- [Guard](../concepts/guard.md)
- [Identity and grants](../concepts/identity-and-grants.md)
- [Spec conformance](../policies/spec-conformance.md)
