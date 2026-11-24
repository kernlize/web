# Asks

Some moments need the person: a write that replaces part of their record, a file leaving their device, a download program acting for an applet, a direct session, a link a firewall rule says to ask about, the choice of which applet takes a request, which way a reply travels, and an applet's settings form. kernl calls each of these an ask ([D-067](../decisions.md#d-067)).

## Who decides what

The kernel decides that the person is asked and what they are told. The host decides how the question looks. Each ask has a kind and carries two things:

- **Facts:** the structured data, such as the applet that asked by name and hash, the draft and the version it replaces, or a file's name and size.
- **`defaultText`:** kernl's own wording.

A host may reword the question but always receives the facts. It registers one renderer per kind in `KernlHost.asks`, and the renderer resolves with the person's answer. [The core package](../packages/core.md#asks) lists every kind, its facts and its refusal.

## What the kernel holds to

These rules are floor features. No host and no module loosens them:

- **A question nobody draws is refused.** A kind the host has no renderer for gets its refusal, never an allow, and so does a renderer that fails. A host that registers none gets a shell where every consent is refused, and nothing throws.
- **An answer belongs to the window that asked.** The kernel holds the answer, not the host. An answer that arrives once that window has closed, or runs another applet, is discarded.
- **Only a question a decision already bounds is timed out.** That is the firewall's, after ten minutes ([D-056](../decisions.md#d-056)). Every other question waits for the person.
- **No ask carries the shell's own secrets.** A download program's question is words only, never an address, path or the password kernl signs in with (D-052). An applet's settings form is different: it carries the applet's own values, secret ones included, because the person edits them there, and the host masks those.

Two kinds keep what a host without them always got: a reply leaves the way the person's provider order picks, and with no settings form the `config` domain is not offered (D-036).

## Modules ask through the kernel

A module lists the kinds it may raise in `asks` and puts them through `KernelContext.ask`. It cannot ask a kind it did not list, and it never draws the question itself. `canAsk(kind)` tells it whether the host draws a kind, for a module that offers something only when it can be asked about, as the settings module does.

## The callbacks they replace

`presentConsent`, `presentApproval`, `chooseHandler`, `chooseReply` and `presentSettings` still draw the kinds they used to for one minor. A renderer in `asks` wins over the callback it replaces.
