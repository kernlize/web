---
'@kernlize/kernel': minor
---

**Breaking.** `KernlHost` loses the prompt callbacks that typed asks replaced (D-067): `presentConsent`, `presentApproval`, `chooseHandler`, `chooseReply` and `presentSettings`. A host draws every question through `KernlHost.asks`, one renderer per kind, and a kind with no renderer is refused. `AskHost` is now `Pick<KernlHost, 'asks'>`, and `createAskChannel` no longer falls back to a callback.

A host that still passes a callback, directly or through `createKernl` from `@kernlize/preset` or `@kernlize/core`, gets no type error in JavaScript: the callback is ignored and its kinds are refused. Move each one to its renderers. A renderer returns the answer, sync or async, instead of calling `resolve`:

- `presentConsent` becomes `sign.replace`, `upload.file`, `download.add` and `connection.direct`, each `(ask) => boolean`. The old `prompt.summary` is `ask.defaultText`.
- `presentApproval` becomes `firewall.approve`, `(ask) => FirewallChoice | undefined`. The old `prompt.summary` is `ask.facts`, and `ask.signal` aborts when the question is withdrawn.
- `chooseHandler`, `chooseReply` and `presentSettings` become `intent.choose-handler`, `messaging.choose-reply` and `settings.present`. Each receives its old prompt as `ask.facts` and returns what the callback resolved.

`HandlerPrompt`, `ReplyPrompt` and `SettingsPrompt` are the facts of their kinds. `ConsentPrompt` and `FirewallPrompt`, the old callback arguments, stay exported for now.
