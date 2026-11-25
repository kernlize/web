# Render an ask your own way

When the kernel or a module needs the person, it asks your host, and your host draws the question ([Asks](../concepts/asks.md)). This page registers renderers in your own UI for the questions your shell can raise, rewords one from its facts, and handles a question that is withdrawn. The samples are one module, type-checked by `pnpm docs:check`.

## 1. Find the kinds your shell raises

The kernel raises two kinds whatever you compose. Each module raises the kinds it lists in its `asks`, and only while it is loaded:

| Kind | Raised by | Answer | Refusal, when nothing draws it |
| --- | --- | --- | --- |
| `sign.replace` | the kernel | `boolean` | `false`: the write fails with `denied:consent` |
| `firewall.approve` | the kernel | a `FirewallChoice` | `undefined`: refused |
| `upload.file` | files | `boolean` | `false` |
| `download.add` | downloads | `boolean` | `false` |
| `connection.direct` | multiplayer | `boolean` | `false` |
| `intent.choose-handler` | intents | a `HandlerChoice` | `undefined`: cancelled |
| `messaging.choose-reply` | messaging | a `ReplyAnswer` | `undefined`, and the person's provider order picks |
| `settings.present` | settings | nothing | without it, `config` is not offered |

A kind you register no renderer for gets its refusal, never an allow, and so does a renderer that throws. Register every kind your modules raise that you want the person to be able to say yes to.

## 2. Draw kernl's wording in your UI

Each ask carries `facts`, the structured data, and `defaultText`, kernl's wording of them. For the four yes-or-no kinds, `defaultText` is a `ConsentSummary`: a `title`, a `severity` and `lines`, each a `label` with what changes `before` and `after`. One renderer serves all four:

```ts
import type { Ask, ConsentSummary, KernlHost } from '@kernlize/kernel';

/** Your own dialog: resolves true for yes, false for no or dismiss. */
declare function confirmInMyDialog(title: string, lines: readonly string[], tone: 'calm' | 'warning'): Promise<boolean>;

function drawConsent(summary: ConsentSummary): Promise<boolean> {
  const lines = summary.lines.map((line) => [line.label, line.before && `was ${line.before}`, line.after && `becomes ${line.after}`].filter(Boolean).join(': '));
  return confirmInMyDialog(summary.title, lines, summary.severity === 'routine' ? 'calm' : 'warning');
}

const consent = (ask: Ask<'sign.replace' | 'upload.file' | 'download.add' | 'connection.direct'>): Promise<boolean> => drawConsent(ask.defaultText);
```

`severity` is why the person is asked: `destructive` replaces or erases part of their record, `public` puts something where anyone can fetch it, and `direct` connects them to someone who learns their network address. Show the last three so they read differently from routine questions.

## 3. Reword one from its facts

You may say it your own way, as long as the facts reach the person. Here the upload question is written from `facts` instead:

<!-- sample:continues -->
```ts
function uploadQuestion(ask: Ask<'upload.file'>): Promise<boolean> {
  const { filename, mimeType, size, servers } = ask.facts;
  const where = servers.map((server) => new URL(server).host).join(', ');
  return confirmInMyDialog(`Put ${filename ?? 'a file'} online?`, [`${size} bytes of ${mimeType}`, `Anyone with its address can read it, on ${where}`], 'warning');
}
```

## 4. Close a question that is withdrawn

Only the firewall withdraws its questions: when the applet closes, or after ten minutes ([D-056](../decisions.md#d-056)). `ask.signal` aborts then; close your prompt, and the kernel takes the refusal. The answer is one of `ask.facts.choices`, most generous last but for `deny`, which is always last:

<!-- sample:continues -->
```ts
declare function chooseInMyDialog<T extends string>(title: string, lines: readonly string[], choices: readonly T[], signal?: Ask['signal']): Promise<T | undefined>;

function firewallQuestion(ask: Ask<'firewall.approve'>) {
  const { applet, requests, choices } = ask.facts;
  const lines = requests.map((request) => `${request.operation}: ${request.target}`);
  return chooseInMyDialog(`${applet.title} asks`, lines, choices, ask.signal);
}

export const asks: KernlHost['asks'] = {
  'sign.replace': consent,
  'upload.file': uploadQuestion,
  'download.add': consent,
  'connection.direct': consent,
  'firewall.approve': firewallQuestion,
};
```

`chooseInMyDialog` resolves `undefined` when the signal aborts or the person dismisses it. Every other kind waits for the person however long they take.

## 5. One at a time

Questions can arrive together: two applets each upload, or a firewall question lands while a consent is open. Show one at a time, in order, as [the example host's dialog](https://github.com/kernlize/web/blob/main/examples/minimal-host/src/ask.ts) does with a promise queue. The kernel keeps each answer with the window that asked, and discards one that arrives after that window closed, so a slow answer is never applied to the wrong applet.

## 6. Check it

- Leave `upload.file` out of `asks`, and an applet's upload is refused without anyone being asked.
- Answer `false` to `sign.replace` for an applet's profile change: its publish fails with `denied:consent`.
- Close an applet while its firewall question is open: your dialog closes, and the request is refused.

## Related

- [Asks](../concepts/asks.md)
- [Build a shell with your own UX](../tutorials/build-a-shell.md)
- [Change the firewall rules](./change-firewall-rules.md)
