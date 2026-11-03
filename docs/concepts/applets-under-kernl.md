# Applets under kernl

kernl adds nothing to the applet format. An applet that conforms to NIP-5D and the NAPs runs in kernl. What kernl changes is the posture the applet meets: fewer domains until the user grants them, budgets that tighten while the window is hidden or unfocused, and a quarantine for applets that flood the shell. This page explains that posture from the applet's side and how to test against it.

## Use the applet SDK, not this repository

The applet side of the protocol is maintained at [napplet.run](https://napplet.run/docs/). Start there:

- [`@napplet/sdk`](https://www.npmjs.com/package/@napplet/sdk) gives you typed named exports over `window.napplet` for bundler-based projects.
- [`@napplet/conformance`](https://www.npmjs.com/package/@napplet/conformance) is the framework-agnostic conformance engine: a reference mock shell, per-NAP envelope validators, a manifest validator and reporters. `@napplet/conformance-cli` runs it from the command line.
- The [napplet.run getting-started guide](https://napplet.run/docs/guide/getting-started.html) and the [NAP documents](https://github.com/napplet/naps) are the authority on wire format and domain semantics.

kernl's packages are shell-side. You do not import them in an applet.

## What kernl advertises

`shell.init`, the shell's reply to your applet's `hello`, carries the domains this shell offers your applet's identity. In kernl that set is the shell's live domains narrowed by the user's grants (see [Identity and grants](./identity-and-grants.md)), so read it rather than assuming. The sets come from `BASELINE_DOMAINS` and `DOMAIN_CAPABILITIES` in `packages/core/src/grants/domain-capabilities.ts`, the services `createKernlServices` registers (`packages/core/src/kernl-services.ts`), and the domains kehto's runtime serves itself; [Architecture](./architecture.md#where-each-nap-domain-is-served-from) has the same table from the shell's side.

| Posture | Domains | Notes |
| --- | --- | --- |
| Baseline, advertised without a grant | `shell`, `inc`, `theme`, `identity`, `storage` | `BASELINE_DOMAINS`. No network. A blocked applet sees `shell` alone. |
| Offered, advertised once the user grants it | `relay`, `outbox`, `resource`, `dm`, `notify`, `link` | Backed by the services `createKernlServices` registers. In the live shell `dm` has no available provider yet ([Alpha status](../alpha-status.md#messaging-providers-in-the-live-shell)). |
| Offered, advertised once granted, nothing wired behind it | `keys`, `media` | kehto's runtime serves these domains natively, so the shell offers them; kernl wires no host behaviour (hotkeys are not forwarded). |
| Not offered | `config`, `cvm`, `upload`, `intent`, `fs`, `llm`, `cache`, and every other domain | They have a row in `DOMAIN_CAPABILITIES` (or none), but no service is registered, so they are never advertised. |

Put a domain in `requires` only if your applet is useless without it. The launcher lists every domain you name in `requires` or `optional` as a switch that starts off on a first run, marks the required ones "the applet says it needs this", and warns when one is still off; the user can run your applet anyway, and then it sees the domain as unavailable. A user who switches on a domain this shell does not offer gets an error (`invalid:domain`) instead of your applet. Prefer `optional` and a graceful fallback.

## Where the guard acts on your traffic

kehto's bridge owns the port your applet talks over, and kernl sees that traffic only after the runtime has dispatched it ([D-012](../decisions.md#d-012)). Two layers follow from that, and they behave differently:

- **Before dispatch**, kehto's own runtime firewall enforces the profile's per-class rates, which `kernl.mount` installs for your applet's `dTag`. An over-budget envelope is refused by the runtime with an error that starts `firewall:`.
- **After dispatch**, kernl's guard observes the same traffic with the shell's knowledge of visibility and focus. It records guard events and can quarantine your applet, but it cannot hold or refuse a single envelope.

The window-level `hello` is the one message kernl filters before kehto sees it.

## What the strict profile means for you

The shell boots in `strict`. The numbers are in [Guard](./guard.md#profiles); the behaviours you will notice:

**Hidden windows are not paused.** While your window is minimised or the page is hidden, your envelopes are still dispatched; nothing is queued for later. The visibility gate holds only a window-level `hello` sent while hidden. What hiding changes is your budget: hidden implies unfocused, so the reactive firewall counts you at the unfocused capacity, and resource requests count against the hidden allowance below. Still design as if delivery can stall: do not time out a request after a few seconds, and do not assume a subscription delivers while you are hidden. A true pre-dispatch hold is requested upstream ([Alpha status](../alpha-status.md#upstream-gaps)).

**Hidden resource allowance.** A hidden window may make 8 `resource.*` requests; the ninth quarantines it with `flood:hidden-resource`. The count resets as soon as the window is visible again. Fetch what you need while visible.

**Rate limits by operation class.** Each class has its own token bucket, keyed by your applet's `dTag`, so two windows of your applet share one budget. In `strict`: 30 `relay.subscribe` and 20 `relay.publish` per minute, 20 `dm.send` and 10 `intent.*` per minute, 120 `resource.*` and 60 `storage.set`/`storage.remove` per 10 seconds. These are the limits the runtime enforces before dispatch, with kehto's default unfocused multiplier; deletions (kind 5) count against the `relay.publish` budget there and have no bucket of their own. After dispatch, kernl's firewall counts the same classes again, plus 5 deletions per minute, at 0.25 of capacity while your window is not focused, and reports each overrun as a guard event such as `rate:relay:publish` or `rate:relay:publish:delete`. Those reports do not refuse anything.

**Ingress flood control.** kernl counts 8 messages per second per window. Above that it reports `flood:burst` (and `flood:queue-full` once 64 are counted as waiting); for port traffic these are events only. The hard limit is real: 300 messages inside any rolling 10 seconds quarantines the window with `flood:quarantine`. Batch your writes and coalesce your subscriptions.

**Quarantine stops your applet.** A quarantined window has its binding revoked and its frame removed. The user sees "This applet was stopped." and can open your applet again in a fresh window; nothing resumes on its own.

**Envelope caps.** `resource.*` envelopes over 64 KiB and `relay.subscribe`/`outbox.subscribe` (including `outbox.query`) envelopes over 256 KiB are reported as `size:<class>`. In this draft port traffic is observed after dispatch, so the cap is not enforced on the port; do not rely on that. Large filters are a smell; split them.

**No init-burst exemption.** kehto's own init-burst guard is not what runs here: kernl counts the same 8 messages per second from the first message your applet sends. Load lazily: request the first screen, render, then fetch the rest.

**Consent for destructive kinds.** When your applet asks the shell to sign an event of kind 0, 3, 5, 10002 or a list kind (10000–10099, 30000–30099), through `relay.publish` or `outbox.publish`, kernl shows the user a summary of what changes and waits. Expect the publish to take as long as a person takes to read. If they refuse, signing fails with `denied:consent` and nothing is published; you receive the normal error envelope. Every other kind is signed without a prompt, and nothing is remembered: the next destructive write asks again.

None of this changes the wire format. A refusal is a normal NAP error envelope; a guard event is visible to the user, not to your applet.

## Test against the guard

You can exercise the guard's layers without the full shell, because `@kernl/guard` is pure. The packages are not yet on npm, so this needs a clone of the kernl source ([Packages](../packages/index.md#install)). The visibility gate below is the layer that holds a hidden window's `hello`; the ingress guard is the one that counts and quarantines.

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

1. Mount hidden, then show: your UI settles whether replies arrived while hidden or after.
2. Lose focus mid-operation: your publish completes or fails cleanly; nothing is retried twice.
3. Hit a rate limit on purpose: your applet shows the user something useful instead of a stack trace.
4. Be declined: require nothing you cannot explain in the one line the launcher shows.
5. New build, old user: your applet's new hash has no grants. Make the first run after an update as good as the first run ever.

## Run it in kernl

Follow [Run the shell](../tutorials/run-the-shell.md), publish your applet with the napplet tooling to a relay in the shell's `apps` tier (by default `wss://relay.napplet.soy`), click **Open an applet** and paste its address. The launcher shows which switches your `requires` and `optional` produced. The guard panel (*Guard · strict · N* in the desktop bar) lists every guard event your applet triggered as a sentence that names the applet, what happened and why ("Applet … was refused: too many publishes" for `rate:relay:publish`); the window's grants panel shows how many guard events it has had this session. Together they are the fastest feedback you will get on posture.

## Related

- [Guard](./guard.md)
- [Identity and grants](./identity-and-grants.md)
- [Spec conformance](../policies/spec-conformance.md)
- [Troubleshooting](../guides/troubleshooting.md)
