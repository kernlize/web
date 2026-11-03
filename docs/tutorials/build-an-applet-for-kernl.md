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

**Deferral when hidden.** When your window is minimised or on an inactive workspace, envelopes in most classes are queued, not dispatched, and drained when the window is visible again. Your `await` resolves late, not with an error. Design for it: do not time out a request after a few seconds, and do not assume a subscription delivers while you are hidden. Up to 200 envelopes are held; more are rejected with `flood:hidden`.

**Hidden resource allowance.** A hidden window may make 8 `resource.*` requests before it is quarantined. Fetch what you need while visible.

**Rate limits by operation class.** Each class (`relay:subscribe`, `relay:publish`, `outbox:publish`, `resource:bytes`, `storage:write`, `dm:send`, `intent:invoke` and others) has its own token bucket per window. While unfocused, capacity is multiplied by 0.25. A rejected envelope carries a stable reason such as `rate:relay:publish`.

**Ingress flood control.** More than 8 messages per second queues; a queue over 64 rejects; 300 messages in 10 seconds quarantines the window until the user intervenes. Batch your writes and coalesce your subscriptions.

**Envelope caps.** `resource.*` envelopes over 64 KiB and `relay.subscribe`/`outbox.subscribe` envelopes over 256 KiB are rejected before parsing. Large filters are a smell; split them.

**Init-burst guard.** A burst of operations during initialisation is blocked by kehto's firewall. Load lazily: request the first screen, render, then fetch the rest.

**Consent for destructive kinds.** Publishing kind 0, 3, 5 or 10002 shows the user a diff of what changes and waits. Expect the publish to take as long as a person takes to read, and expect `denied:` if they refuse.

None of this changes the wire format. A rejection is a normal NAP error envelope with a reason string; a deferral is latency.

## Test against the guard

You can exercise the guard without the full shell. `@kernl/guard` is pure, and the mock shell in `@napplet/conformance` can be wrapped with it:

```ts
import { createIngressGuard, createVisibilityGate, profiles } from '@kernl/guard';

const config = profiles.strict;
const guard = createIngressGuard(config, { now: () => performance.now() });
const gate = createVisibilityGate(config);

gate.setVisibility('w1', { visible: false, focused: false });
guard.admit('w1', 'my-applet', { type: 'relay.subscribe', size: 512 }, gate.getVisibility('w1'));
// → 'defer'

gate.setVisibility('w1', { visible: true, focused: true });
for (let i = 0; i < 9; i += 1) guard.admit('w1', 'my-applet', { type: 'relay.publish', kind: 1 }, gate.getVisibility('w1'));
// the ninth call within one second → 'defer' (queued), not 'pass'
```

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
