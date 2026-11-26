# Build a shell with your own UX

This tutorial builds a page of your own on kernl's kernel: no Svelte, no store and no window manager, only the parts you choose. By the end your page signs someone in, opens one applet pinned by its hash, asks every question in its own dialog, and lets the applet send a private message and upload a file. It takes about thirty minutes.

The finished page is [`examples/minimal-host`](https://github.com/kernlize/web/tree/main/examples/minimal-host) in the kernl repository, and its end-to-end test runs in CI against relays and file servers that exist only in the browser. If a step does not do what it says, compare with it.

## 1. Make a project and install the kernel

Anywhere outside the kernl repository:

```bash
mkdir my-shell && cd my-shell
npm init -y && npm pkg set type=module
npm install @kernlize/kernel @kernlize/modules
npm install --save-dev vite typescript
mkdir src public
```

`@kernlize/kernel` is the part no host can switch off: the sandbox, the guard, grants, consent before a destructive write, the firewall and the seal on messages. `@kernlize/modules` is kernl's opinions, one entry per module, so you load only those you name ([Kernel, modules and presets](../concepts/kernel-modules-and-presets.md)). On JSR they are `@kernl/kernel` and `@kernl/modules`.

**Checkpoint.** `node_modules/@kernlize/kernel/package.json` exists. The per-module entries, such as `@kernlize/modules/messaging`, need `@kernlize/modules` 0.2.0 or later; check with `npm ls @kernlize/modules`.

## 2. Write the page

Create `index.html`. The first `<meta>` is kernl's frame policy, `KERNL_FRAME_POLICY_META`: no frame on this page may load or navigate to a URL, so an applet's only content is the verified copy the kernel gives it. It has to be in the HTML the server sends, before any script.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="frame-src 'none'">
    <title>My shell</title>
  </head>
  <body>
    <p id="who">Not signed in</p>
    <button id="sign-in" type="button">Sign in with a throwaway identity</button>
    <section id="card" hidden>
      <h2 id="card-title"></h2>
      <p id="card-description"></p>
      <button id="open" type="button">Open</button>
    </section>
    <p id="problem" role="alert" hidden></p>
    <div id="stage"></div>
    <dialog id="ask">
      <form method="dialog">
        <h2 id="ask-title"></h2>
        <ul id="ask-lines"></ul>
        <div id="ask-extra"></div>
        <button value="no">No</button>
        <button value="yes">Yes</button>
      </form>
    </dialog>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

**Checkpoint.** `npx vite` serves the page. The console shows a 404 for `main.ts`, which comes next.

## 3. Ship one applet and pin it

Your shell opens one applet, which it ships itself. Save a single-file napplet as `public/applet.html`; [the example's](https://github.com/kernlize/web/blob/main/examples/minimal-host/public/applet.html) sends a note as a private message through `window.napplet.dm` and uploads it as a file through `window.napplet.upload`. [Write an applet](./write-an-applet.md) shows how to make your own.

The page pins the applet by the SHA-256 of its bytes. Fix the pin when you build, so a changed file cannot run without a new build. Create `vite.config.ts`:

<!-- sample:skip runs in Node under Vite, not in the page -->
```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const applet = readFileSync(new URL('./public/applet.html', import.meta.url));

export default defineConfig({
  base: './',
  define: { __APPLET_SHA256__: JSON.stringify(createHash('sha256').update(applet).digest('hex')) },
});
```

## 4. Implement the host

Create `src/main.ts`. The kernel never touches your page: everything it needs goes through a `KernlHost`, and every question it has for the person goes to one of your renderers in `host.asks`. A kind of question you register no renderer for is refused, never allowed ([Asks](../concepts/asks.md)).

Start with your own dialog. It shows one question at a time, and a dismissed dialog is a no:

```ts
import { createKernel, createThrowawayIdentity, type AppletHandle, type AppletSummary, type BuiltinApplet, type KernlHost } from '@kernlize/kernel';
import { messagingModule, privateDm } from '@kernlize/modules/messaging';
import { filesModule } from '@kernlize/modules/uploads';

declare const __APPLET_SHA256__: string;

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;

interface Reply {
  readonly yes: boolean;
  readonly ticked: readonly string[];
}

let queue: Promise<unknown> = Promise.resolve();

function ask(title: string, lines: readonly string[], choices: readonly { id: string; label: string }[] = []): Promise<Reply> {
  const dialog = $<HTMLDialogElement>('#ask');
  const show = (): Promise<Reply> => {
    $('#ask-title').textContent = title;
    $('#ask-lines').replaceChildren(...lines.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
    $('#ask-extra').replaceChildren(...choices.map((choice) => {
      const label = document.createElement('label');
      label.append(Object.assign(document.createElement('input'), { type: 'checkbox', name: choice.id }), ` ${choice.label}`);
      return label;
    }));
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => resolve({
      yes: dialog.returnValue === 'yes',
      ticked: [...dialog.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.name),
    }), { once: true }));
  };
  const reply = queue.then(show);
  queue = reply.catch(() => undefined);
  return reply;
}
```

Then the host. Of the two modules this shell loads, only the files module asks the person anything, `upload.file`, before a file leaves. Its facts are the file, its size and the servers; `defaultText` is kernl's wording of them, which you may reword:

<!-- sample:continues -->
```ts
let frame: HTMLIFrameElement | undefined;
let handle: AppletHandle | undefined;

function problem(text: string | undefined): void {
  $('#problem').hidden = text === undefined;
  $('#problem').textContent = text ?? '';
}

const host: KernlHost = {
  storage: localStorage,
  asks: {
    'upload.file': async (question) => {
      const lines = question.defaultText.lines.map((line) => (line.after === undefined ? line.label : `${line.label}: ${line.after}`));
      return (await ask(question.defaultText.title, lines)).yes;
    },
  },
  notify: (notice) => problem(notice.title),
  openLink(url, options) {
    if (options?.approved) window.open(url, '_blank', 'noopener,noreferrer');
  },
  getVisibility: () => {
    const visible = frame?.isConnected === true && document.visibilityState === 'visible';
    return { visible, focused: visible && document.hasFocus() };
  },
  onRevoked(_windowId, reason) {
    frame?.remove();
    problem(`The applet was stopped (${reason}).`);
  },
};
```

`getVisibility` and `onRevoked` are how the guard and your page stay honest with each other: the guard holds a hidden applet to a smaller allowance, and when it stops one, it is your page that takes the frame away ([Guard](../concepts/guard.md)).

## 5. Compose the kernel

Name the modules you want and the applet you ship:

<!-- sample:continues -->
```ts
const NOTE: BuiltinApplet = {
  id: 'note',
  title: 'Note to a friend',
  description: 'Sends a note as a private message, or uploads it as a file.',
  sha256: __APPLET_SHA256__,
  requires: ['dm'],
  optional: ['upload'],
  async load() {
    const response = await fetch(new URL('./applet.html', document.baseURI));
    if (!response.ok) throw new Error(`applet.html answered ${response.status}`);
    return response.text();
  },
};

const kernl = createKernel({
  host,
  builtins: [NOTE],
  modules: [messagingModule({ providers: [privateDm()] }), filesModule()],
});
window.addEventListener('message', (event) => kernl.handleWindowMessage(event));
document.addEventListener('visibilitychange', () => handle?.setVisibility(host.getVisibility(handle.windowId)));
```

- **The modules.** `messagingModule({ providers: [privateDm()] })` answers the `dm` domain with sealed, gift-wrapped messages (NIP-17), and `filesModule()` answers `upload` with the person's file servers. A domain no module answers is never offered, so this shell has no store, no settings and no downloads; the bundler never reads them.
- **The applet.** A `BuiltinApplet` opens as `kernl:note` without looking anything up. The kernel hashes the bytes `load` returns and refuses any that do not match `sha256`, with `invalid:artifact-hash`.
- **The listener.** `handleWindowMessage` is how an applet's messages reach the guard and then the kernel. Add it exactly once.

**Checkpoint.** The page loads with no errors in the console, and `kernl.grants.availableDomains()` includes `dm` and `upload`.

## 6. Ask before opening

An applet's `requires` and `optional` are what it says it needs; only the person grants. Ask in your dialog, then record what they said:

<!-- sample:continues -->
```ts
async function agree(summary: AppletSummary): Promise<boolean> {
  if (kernl.grants.get(summary.identity)?.domains.includes('dm')) return true;
  const reply = await ask(`Open ${summary.title}?`, [summary.description, 'It can read and send your private messages.'], [
    { id: 'upload', label: 'Let it upload files too. It can read your messages, so a file could carry them out.' },
  ]);
  if (!reply.yes) return false;
  kernl.grants.allowDomain(summary.identity, 'dm');
  if (reply.ticked.includes('upload')) kernl.grants.allowDomain(summary.identity, 'upload', { unsafe: true });
  return true;
}
```

An applet that can read messages keeps only the domains that cannot carry them anywhere: `upload` is withheld beside `dm` even when granted ([D-046](../decisions.md#d-046)). `unsafe: true` keeps it anyway, and only the person's own answer may set it ([D-060](../decisions.md#d-060)). That is why the choice is a box in your dialog, off until they tick it.

## 7. Resolve, plan and mount

<!-- sample:continues -->
```ts
async function open(summary: AppletSummary): Promise<void> {
  problem(undefined);
  if (!(await agree(summary))) return;
  try {
    const plan = await kernl.plan(summary);
    frame = document.createElement('iframe');
    frame.title = summary.title;
    $('#stage').replaceChildren(frame);
    handle = kernl.mount(plan, frame);
  } catch (error) {
    problem(`Could not open ${summary.title}: ${(error as Error).message}`);
  }
}

$('#sign-in').addEventListener('click', async () => {
  const session = await kernl.login(createThrowawayIdentity('My shell'));
  $('#who').textContent = `Signed in as ${session.pubkey}`;
  try {
    const summary = await kernl.resolve(kernl.decodePointer(`kernl:${NOTE.id}`));
    $('#card-title').textContent = summary.title;
    $('#card-description').textContent = summary.description;
    $('#open').onclick = () => void open(summary);
    $('#card').hidden = false;
  } catch (error) {
    problem(`${NOTE.title} was not opened: ${(error as Error).message}`);
  }
});
```

The order matters:

1. **`resolve`** reads and verifies the applet. For a builtin that means hashing the bytes against the pin.
2. **`plan`** writes the applet's access from the grants, and lets the firewall admit it, before any of its code runs. Its `missingRequired` lists required domains the person did not grant.
3. **`mount`** needs the frame attached to the document. It sets the sandbox to exactly `allow-scripts` and only then assigns the verified copy as `srcdoc`, so do not set `src`, `sandbox` or `srcdoc` yourself.

`createThrowawayIdentity` makes an identity whose key lives only in this tab. A page for real use offers a signing extension or a remote signer, as [kernl.run's sign-in](./run-the-shell.md) does.

**Checkpoint.** Sign in, then Open. Your dialog asks; say Yes, and the applet shows "ready". Type a friend's key in hex and a note, then Send: the applet says "sent". Tick the upload box on a fresh visit (or clear the site's storage) and choose Upload: your dialog asks first, naming the file and the servers.

## 8. Check the pin

Change one character in `public/applet.html` while the dev server runs, without restarting it, and reload. The pin was fixed when Vite started, so the bytes no longer match it, and sign-in shows "Note to a friend was not opened: invalid:artifact-hash". Nothing was mounted. Restart Vite to take the new pin.

## What you built

A complete kernl host with its own UX: it verifies the one applet it runs, runs it in a frame with no network of its own, asks the person everything in its own words, and keeps the guard told what is on screen. The kernel decided what is safe; your page decided everything the person sees.

## Where next

- [Kernel, modules and presets](../concepts/kernel-modules-and-presets.md): what the kernel keeps whatever you compose, and what each module adds.
- [Run the shell](./run-the-shell.md): kernl.run, the same kernel under every module kernl ships.
- [Asks](../concepts/asks.md): every kind of question, its facts and its refusal.
- [Grant and revoke](../how-tos/grant-and-revoke.md): the grant calls in full.
