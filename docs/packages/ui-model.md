# @kernlize/ui-model

Framework-free view models for a kernl shell's panels. A host's UI binds to them and keeps its own look. Today the package holds the grants list. The ask queues, the guard and traffic logs, notices and unread counts move here from kernl.run next (#74).

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
| `PACKAGE_NAME` | `'@kernlize/ui-model'` | |
| `GrantInput`, `GrantState`, `GrantChoices`, `GrantGroup`, `GrantGroupId`, `GrantRow`, `GrantOp` | types | |

Generated module: [`_kernlize_ui-model`](../api/modules/_kernlize_ui-model.html){target="_self"}
