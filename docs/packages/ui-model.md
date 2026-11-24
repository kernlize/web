# @kernlize/ui-model

Framework-free view models for a kernl shell's panels. A host's UI binds to them and keeps its own look. It holds the grants list and the ask queues. The guard and traffic logs, notices and unread counts move here from kernl.run next (#74).

| Field | Value |
| --- | --- |
| npm | `@kernlize/ui-model` |
| JSR | `@kernl/ui-model` |
| Version | `0.1.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | `@kernlize/core workspace:^` |
| Peer dependencies | none |
| Side effects | none |

## Install

This package is `@kernlize/ui-model` on npm and `@kernl/ui-model` on JSR, the same code at the same version.

```sh
npm install @kernlize/ui-model
# or
deno add jsr:@kernl/ui-model
```

It reads only the message seal from `@kernlize/core`, through `@kernlize/core/seal`. A host that draws the grants list therefore bundles no network stack and no third-party code; `features/bundling.feature` checks this. No other package imports `@kernlize/ui-model` (`pnpm check:deps` enforces that), so a shell that draws its own panels never loads it.

## The grants list

What an applet asks for, what the shell can give and what stands for the applet become the switches a person sees. The model is the one kernl.run draws, moved here unchanged ([D-060](../decisions.md#d-060)).

```ts
import { grantGroups, grantsToApply, startingChoices, type GrantInput, type GrantState } from '@kernlize/ui-model';

const input: GrantInput = { requires: ['relay', 'dm'], optional: ['upload'], baseline: ['shell', 'storage'], available: ['relay', 'dm', 'upload'] };
const state: GrantState = { granted: [], unsafe: [] };

const choices = startingChoices(input, state, true);
for (const group of grantGroups(input, choices)) {
  console.log(group.label, group.rows.map((row) => `${row.label}${row.on ? ' (on)' : ''}${row.note ? `: ${row.note}` : ''}`));
}
// When the person confirms:
const ops = grantsToApply(input, choices, state);
```

- **`startingChoices(input, state, force)`:** what was granted shows as on. With `force`, every required domain the shell can offer is on too, as when an applet is about to run.
- **`grantGroups(input, choices)`:** the groups, in the order they are shown: `unsafe`, `required`, `optional`, then `other`.
  - A required domain that cannot sit beside messages goes under "Unsafe with messages", off until the person allows it ([D-046](../decisions.md#d-046)).
  - A domain the shell cannot offer, or an optional one messages withhold, is off and fixed.
  - A baseline domain is always on.
- **`grantsToApply(input, choices, state)`:** what confirming comes to, as `allow` and `revoke` operations. An allowed unsafe domain is kept beside messages. Nothing is applied for what already stands, for a baseline domain, for one the shell cannot offer, or for one messages withhold.

## Ask queues

The kernel puts its questions to the person as asks, one renderer per kind ([Asks](../concepts/asks.md)). A queue holds them for a dialog:

- **One at a time.** The queue shows its questions one at a time, in arrival order. `current$` is the one in front, and `answer(value)` resolves it and brings the next forward.
- **Revoked windows.** `dismissWindow(windowId)` answers every waiting question from a window with its refusal, for when the shell stops an applet.
- **Withdrawn questions.** One the kernel withdraws through its `signal`, such as a firewall question left unanswered, leaves the queue by itself.

`createAskRenderers` turns queues into `KernlHost.asks`, and several kinds may share one queue, as kernl.run's consent dialog does. The queues read the kinds from `@kernlize/core/asks`, so they load without the network stack.

```ts
import { createKernl, type KernlHost } from '@kernlize/core';
import { createAskQueue, createAskQueues, createAskRenderers } from '@kernlize/ui-model';

declare const host: KernlHost;
declare function draw(title: string | undefined): void;

const queues = createAskQueues();
const consent = createAskQueue<'sign.replace' | 'upload.file'>();
const kernl = createKernl({ host: { ...host, asks: createAskRenderers({ ...queues, 'sign.replace': consent, 'upload.file': consent }) } });

consent.current$.subscribe((ask) => draw(ask?.defaultText.title));
// The person says yes to the question on screen:
consent.answer(true);
```

## Exports

| Export | Signature | Description |
| --- | --- | --- |
| `startingChoices` | `(input: GrantInput, state: GrantState, force: boolean) => GrantChoices` | The switches a person starts from. |
| `grantGroups` | `(input: GrantInput, choices: GrantChoices) => GrantGroup[]` | The grants list as captioned groups of rows. |
| `grantsToApply` | `(input: GrantInput, choices: GrantChoices, state: GrantState) => GrantOp[]` | The grants to make or take back on confirm. |
| `withheldByMessages` | `(domain: string, on: readonly string[]) => boolean` | Whether messages withhold a domain, given what is switched on (D-046). |
| `domainLabel` | `(domain: string) => string` | Plain words for a domain; `UNKNOWN_DOMAIN_LABEL` for one the shell has no words for. |
| `contractName` | `(domain: string) => string` | The contract beside the words, the domain in capitals (D-057). |
| `formatBytes` | `(bytes: number) => string` | Byte counts in binary units. |
| `GROUP_LABELS`, `WITHHELD_NOTE`, `UNKNOWN_DOMAIN_LABEL` | constants | The captions and notes the list shows. |
| `createAskQueue` | `<K extends AskKind>() => AskQueue<K>` | A queue of asks: `waiting$`, `current$`, `enqueue`, `answer`, `dismissWindow`, `forWindow`. |
| `createAskQueues` | `() => AskQueues` | One queue for each ask kind. |
| `createAskRenderers` | `(queues: AskQueuesByKind) => AskRenderers` | `KernlHost.asks` over the queues; a kind left out has no renderer, so the kernel refuses it. |
| `PACKAGE_NAME` | `'@kernlize/ui-model'` | |
| `GrantInput`, `GrantState`, `GrantChoices`, `GrantGroup`, `GrantGroupId`, `GrantRow`, `GrantOp`, `AskQueue`, `AskQueues`, `AskQueuesByKind` | types | |

Generated module: [`_kernlize_ui-model`](../api/modules/_kernlize_ui-model.html){target="_self"}
