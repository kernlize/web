# Applets under kernl

kernl adds nothing to the applet format. An applet that conforms to NIP-5D and the NAPs runs in kernl. What kernl changes is the posture the applet meets: fewer domains until the user grants them, budgets the runtime enforces, no frames of its own, and a quarantine for applets that flood the shell. This page explains that posture from the applet's side and how to test against it.

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
| Baseline, advertised without a grant | `shell`, `inc`, `theme`, `storage` | `BASELINE_DOMAINS`. No network, and no account. Storage is the applet's own, read and write. A blocked applet sees `shell` alone. |
| Offered, advertised once the user grants it | `identity`, `relay`, `outbox`, `resource`, `dm`, `notify`, `link`, `intent` | Backed by the services `createKernlServices` registers. `identity` is "your account" in the launcher: until it is granted, your applet is not told who is signed in. In the live shell `dm` reaches `private` and `legacy` while the signed-in account can encrypt; with nobody signed in no provider is available ([Alpha status](../alpha-status.md#messaging-providers-in-the-live-shell)). |
| Offered, advertised once granted, nothing wired behind it | `keys`, `media` | kehto's runtime serves these domains natively, so the shell offers them; kernl wires no host behaviour (hotkeys are not forwarded). |
| Not offered | `config`, `cvm`, `upload`, `fs`, `llm`, `cache`, and every other domain | They have a row in `DOMAIN_CAPABILITIES` (or none), but no service is registered, so they are never advertised. |

`intent` is "opening other applets": with it your applet can ask for a role and an action and receive what other applets hand it. An applet that requires it to ask, or that takes requests (it has `z` and `i` tags), is offered the switch already on at its first run, because a handler without it receives nothing. See [The store and intents](./store-and-intents.md).

Put a domain in `requires` only if your applet is useless without it. The launcher lists every domain you name in `requires` or `optional` as a switch that starts off on a first run, marks the required ones "the applet says it needs this", and warns when one is still off; the user can run your applet anyway, and then it sees the domain as unavailable. A domain this shell does not offer is listed with its switch disabled and marked "not available in this shell"; your applet opens without it, and when it was in `requires` the launcher says the applet may not work here. Prefer `optional` and a graceful fallback.

## Where the guard acts on your traffic

kehto's bridge owns the port your applet talks over. kehto asks kernl about each envelope before its runtime sees it, and kernl answers dispatch, hold or drop ([D-020](../decisions.md#d-020)). Two layers follow from that, and they behave differently:

- **kernl's guard drops, holds and quarantines.** It judges your traffic with the shell's knowledge of visibility and focus and records guard events. Whatever it will not let through (an oversized request, a burst above 8 per second, a request over a class budget, smaller while you are not focused) is dropped: it is not handled and you get no reply, so give every request a timeout. Anything but a control message while your window is hidden is held and answered once you are visible. Control messages (`shell.*`, `inc.*`, `theme.*`, closes) are dispatched. When an envelope pushes your applet over a quarantine limit, kernl revokes the binding inside that decision, so that envelope is not dispatched and your applet is closed.
- **kehto's runtime firewall refuses.** It enforces the profile's per-class rates, which `kernl.mount` installs for your applet's `dTag`, at the window's focus, and the profile's startup burst guard. An envelope it refuses is answered with an error that starts `firewall:`. Because kernl counts the same rates first, you mostly meet the runtime's refusals in your first second and for held requests released over budget.

The window-level `hello` is filtered by kernl before kehto sees it.

## What the strict profile means for you

The shell boots in `strict`. The numbers are in [Guard](./guard.md#profiles); the behaviours you will notice:

**Hidden windows wait.** While your window is minimised or the page is hidden, every request other than a control message is held, and answered in order once you are visible again; do not retry it. Control messages are answered while nothing is held; once a request is held, later messages, control ones included, queue behind it. A hidden window holds at most 200 requests in `strict`; past that, requests are dropped without a reply. Resource requests also count against the hidden allowance below, which quarantines ([D-020](../decisions.md#d-020)).

**Hidden resource allowance.** A hidden window may make 8 `resource.*` requests; the ninth quarantines it with `flood:hidden-resource`, and that ninth request is not dispatched. The count resets as soon as the window is visible again. Fetch what you need while visible.

**Rate limits by operation class.** Each class has its own token bucket, keyed by your applet's `dTag`, so two windows of your applet share one budget. In `strict`: 30 `relay.subscribe` and 20 `relay.publish` per minute, 20 `dm.send` and 10 `intent.*` per minute, 120 `resource.*` and 60 `storage.set`/`storage.remove` per 10 seconds. While your window is not focused, each budget is 0.25 of its capacity. kernl's focus firewall counts these classes first, plus 5 deletions per minute, and drops an overrun without a reply, with a guard event such as `rate:relay:publish` or `rate:relay:publish:delete`. The runtime enforces the same budgets, focus included, on what it handles, which matters for requests held while you were hidden: those over budget when released are refused with a `firewall:` error. Deletions (kind 5) count against the `relay.publish` budget in the runtime.

**Ingress flood control.** kernl counts 8 messages per second per window. Above that, non-control requests are dropped without a reply, with a `flood:burst` event; nothing is queued, so time out and retry later. The hard limit is real: the 300th message inside any rolling 10 seconds quarantines the window with `flood:quarantine`, and that message is not dispatched. Batch your writes and coalesce your subscriptions.

**Quarantine stops your applet.** A quarantined window has its binding revoked and its frame removed. The user sees "This applet was stopped." and can open your applet again in a fresh window; nothing resumes on its own.

**Envelope caps.** `resource.*` envelopes over 64 KiB and `relay.subscribe`/`outbox.subscribe` (including `outbox.query`) envelopes over 256 KiB are dropped before dispatch: your applet gets no reply, nothing is fetched, and the user sees a `size:<class>` guard event. Large filters are a smell; split them.

**A startup burst limit.** kehto's runtime counts every operation in your window's first second, control messages included, and refuses everything past the 8th in `strict` (12 in `balanced`, 24 in `relaxed`) with a `firewall:` error. kernl also counts 8 messages per second from the first message, and drops non-control requests above that. Load lazily: request the first screen, render, then fetch the rest.

**No frames of your own.** kernl refuses to mount an applet whose markup contains an `iframe`, `frame`, `frameset`, `object`, `embed`, `portal` or `fencedframe` element (`denied:nested-frame`), and inside the window every way of creating one throws `TypeError: denied:nested-frame`: `createElement`, `createElementNS`, `createDocument`, and any HTML string with a frame tag written to `innerHTML`, `insertAdjacentHTML`, `document.write` or a parser. A child frame would be a fresh realm with a network path the shell cannot see ([D-014](../decisions.md#d-014)). Render into your own document instead. Two side effects to know: a string written to an HTML sink that merely mentions a frame tag, in text or an attribute, is refused too, so escape such text or set it with `textContent`; and the window's CSP carries `require-trusted-types-for 'script'; trusted-types default`, so your applet must not register a Trusted Types policy of its own, `default` or any other name. Libraries that create one need a fallback.

**Consent for destructive kinds.** When your applet asks the shell to sign a replaceable event (kind 0, 3 or 10000–19999), an addressable event (30000–39999), a deletion (5) or a request to vanish (62), through `relay.publish` or `outbox.publish`, kernl looks up the version it replaces (for up to 4 seconds on the network), shows the user a summary of what changes and waits. Expect the publish to take as long as a person takes to read. If they refuse, signing fails with `denied:consent` and nothing is published; you receive the normal error envelope. Every other kind is signed without a prompt, and nothing is remembered: the next destructive write asks again.

None of this changes the wire format. A refusal is a normal NAP error envelope; a dropped request gets no envelope at all, because NAP defines none for it, so give every request a timeout. A guard event is visible to the user, not to your applet.

## Test against the guard

You can exercise the guard's layers without the full shell, because `@kernlize/guard` is pure. The packages are not released yet (`@kernlize/*` on npm, `@kernl/*` on JSR), so this needs a clone of the kernl source ([Packages](../packages/index.md#install)). The visibility gate below is the layer that holds a hidden window's `hello`; the ingress guard is the one that counts and quarantines.

```ts
import { createGuardConfig, createIngressGuard, createVisibilityGate, type GuardEvent } from '@kernlize/guard';

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

[Write an applet](../tutorials/write-an-applet.md) walks through this end to end with a minimal applet. In short: follow [Run the shell](../tutorials/run-the-shell.md), publish your applet with the napplet tooling to a relay in the shell's `apps` tier (by default `wss://relay.napplet.soy`), click **Open an applet** and paste its address. The launcher shows which switches your `requires` and `optional` produced. The guard panel (*Guard · strict · N* in the desktop bar) lists every guard event your applet triggered as a sentence that names the applet, what happened and why ("Applet … went over a limit: too many publishes" for `rate:relay:publish`; kernl reports these, and the runtime's rates do the refusing); the window's grants panel shows how many guard events it has had this session. Together they are the fastest feedback you will get on posture.

## Related

- [Guard](./guard.md)
- [Identity and grants](./identity-and-grants.md)
- [Spec conformance](../policies/spec-conformance.md)
- [Troubleshooting](../guides/troubleshooting.md)
