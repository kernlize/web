# Change the firewall rules

Grants decide which domains an applet holds. The firewall decides, inside those, what goes ahead without asking, what asks the user, and what is refused ([Guard](../concepts/guard.md#the-firewall), [D-050](../decisions.md#d-050)). The shell starts with two rules: everything the user granted is allowed, and opening a link outside the shell asks every time. This page changes them, in the shell and in code.

## In the shell

1. Click **Firewall** in the desktop bar, or in the **Menu** on a narrow screen.
2. Under *For every applet*, set *Everything you granted* and *Opening links* to **Allow without asking**, **Ask me every time** or **Refuse**. *By kind* opens one row per domain the shell offers. A row left on **Follow the wider rule** has no rule of its own.
3. Under *For one applet*, give an open applet its own rule for opening links. The rule follows that applet across versions.
4. **Back to the starting rules** restores the two shipped rules.

A stricter rule applies to applets that are already running. An applet that started, or opened a link, under what the old rule allowed is stopped, and its window says a firewall rule or answer it ran under changed. Open it again to run it under the new rule.

*Answers you gave* lists the answers in force that the user gave: what was allowed or refused, for which applet, and whether it lasts until the window closes or is kept across visits. **Take back** removes one and stops the applet that ran under it. If the stored answers cannot be read, the panel says so and offers **Clear stored answers**; until then no applet starts. Answers about links are never listed, because a link is answered for one opening only.

When a rule says to ask, the question names the applet and what it wants. For a link it shows the link and where it leads, with **Open link** and **Don't open**. For anything else it offers **Allow once**, **Allow while open**, **Always allow** and **Don't allow**, as far as each applies. Closing the question allows nothing and keeps nothing.

The offline preview (`?preview=1`) has the same panel over its own stored rules, and its sample applets' links follow them. Nothing runs for real there, so it has no answers to list.

## In code

`kernl.firewall` is the `Firewall` interface on the composed shell.

```ts
import type { Kernl } from '@kernlize/core';

declare const kernl: Kernl;

kernl.firewall.rules().default; // 'allow'
kernl.firewall.rules().operations['link.open']; // 'ask'

// One request, for every applet.
kernl.firewall.setRule({ operation: 'link.open' }, 'allow');
// A whole domain: ask before an applet starts with it.
kernl.firewall.setRule({ domain: 'relay' }, 'ask');
// Everything no narrower rule covers.
kernl.firewall.setRule({}, 'ask');

// One applet, by its catalogue id, across its versions.
for (const handle of kernl.applets()) {
  kernl.firewall.setRule({ applet: handle.summary.manifest.catalogId, operation: 'link.open' }, 'deny');
}

// Remove a rule, so the next wider one applies.
kernl.firewall.setRule({ domain: 'relay' }, undefined);
kernl.firewall.restoreDefaults();

const subscription = kernl.firewall.decisions$.subscribe((decisions) => {
  for (const decision of decisions) console.log(decision.catalogId, decision.request.operation, decision.effect, decision.lifetime, decision.byRule);
});
subscription.unsubscribe();

for (const decision of kernl.firewall.decisions()) {
  if (!decision.byRule) kernl.firewall.forget(decision.id); // false when the stored copy could not be removed
}
kernl.firewall.forgetAll();
```

- **`setRule(target, action)`** takes a `FirewallRuleTarget`, `{ applet?, domain?, operation? }`, and `'allow'`, `'ask'`, `'deny'` or `undefined`. It throws `invalid:rule` for a target kehto refuses, such as a domain that is not a domain name, and leaves the rules as they were.
- **Which rule decides.** The most specific one: the applet's rule for the request, for its domain, the applet's default, then the same three for every applet. A request with several requirements is refused when any is denied and asks when any asks.
- **What a change stops.** `setRule` and `restoreDefaults` take back every answer the old rules gave that the new ones no longer give. Each window that ran under one is removed, and the host hears `onRevoked(windowId, 'firewall')`. `forget` and `forgetAll` do the same for the answers they take back; `forgetAll` stops every applet, because every running applet was admitted under an answer.
- **Where it is kept.** Rules at `kernl:firewall-rules:v1`; the answers the user asked to keep at `kernl:firewall-decisions:v1` ([Persistence](../concepts/persistence.md#keys-the-core-writes)).

A rule that asks needs a host that can ask. An embedding host implements `KernlHost.presentApproval`; without it, a request a rule says to ask about is refused ([Embed kernl core](./embed-kernl-core.md#_2-implement-kernlhost-and-create-the-shell)).

## What a rule cannot change

- **Grants.** A rule cannot give an applet a domain its grant does not. The grant is the ceiling; [Grant and revoke](./grant-and-revoke.md) covers it.
- **Rates.** How often an applet may act is the guard profile's ([Change the guard profile](./change-guard-profile.md)). An approval does not lift a rate limit.
- **Consent for destructive writes.** Signing a change that overwrites or deletes still asks through `presentConsent`, whatever the rules say.
- **How long a link answer lasts.** With the rule on "ask", a link is answered for that one opening. To stop the questions, set the rule for links to `allow`.

## Related

- [Guard](../concepts/guard.md#the-firewall)
- [Identity and grants](../concepts/identity-and-grants.md#the-firewall-inside-the-grants)
- [`@kernlize/core`](../packages/core.md#the-firewall)
