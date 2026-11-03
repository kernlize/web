# Embed kernl in a page

This tutorial builds the smallest page that runs a real applet under kernl: one HTML file, one script, an address field and a frame. By the end you will have resolved a published applet, verified its code, mounted it in a sandboxed frame you own, and watched the guard report on it. It takes about twenty minutes.

[Embed kernl core](../how-tos/embed-kernl-core.md) is the reference version of the same work; this page goes one step at a time and tells you what you should see after each.

::: warning Alpha
The `@kernl/*` packages are not on npm yet. You need a clone of the kernl source repository, which is private during the alpha ([Packages](../packages/index.md#install)).
:::

## 1. Make a workspace package

In your clone, build the packages once, then create a package for your page under `apps/`, which `pnpm-workspace.yaml` already covers:

```bash
pnpm install && pnpm build
mkdir -p apps/my-host/src && cd apps/my-host
```

Give it a `package.json` that depends on the core and the account library through the workspace, and on Vite as a dev server. Any bundler that resolves workspace packages works; Vite is the shortest path.

```json
{
  "name": "my-host",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite" },
  "dependencies": {
    "@kernl/core": "workspace:^",
    "@kernl/guard": "workspace:^",
    "applesauce-accounts": "^7.0.2"
  },
  "devDependencies": { "vite": "^7.0.0" }
}
```

Run `pnpm install` from the repository root.

**Checkpoint.** `apps/my-host/node_modules/@kernl/core` is a link to `packages/core`, and `packages/core/dist/index.js` exists. If `dist/` is missing, run `pnpm build` at the root again.

## 2. Write the page

Create `apps/my-host/index.html`. The `<meta>` in the head is kernl's frame policy (`KERNL_FRAME_POLICY_META`): it stops applet frames from loading or navigating to any URL, so their only content is the verified `srcdoc` kernl assigns. It has to be in the HTML the server sends, before any script runs.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="frame-src 'none'">
    <title>My kernl host</title>
    <style>
      body { font: 16px system-ui, sans-serif; margin: 2rem; }
      #frames iframe { width: 100%; height: 480px; border: 1px solid #888; }
    </style>
  </head>
  <body>
    <form id="open">
      <label>Account id (public key, read-only) <input name="pubkey" size="64" /></label>
      <label>Applet address <input name="address" size="64" /></label>
      <button>Open</button>
    </form>
    <p id="status">Not started.</p>
    <div id="frames"></div>
    <pre id="events"></pre>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

**Checkpoint.** `pnpm dev` in `apps/my-host` serves the form at the URL Vite prints. The status line reads "Not started."; the script does not exist yet, so the browser console shows a 404 for `main.ts`.

## 3. Implement the host

Create `apps/my-host/src/main.ts`. The core never touches the page directly; everything it needs from the page goes through a `KernlHost`. This one stores in `localStorage`, asks with `window.confirm`, and reports visibility from the document.

```ts
import { createKernl, type ConsentPrompt, type KernlHost } from '@kernl/core';
import type { WindowVisibility } from '@kernl/guard';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const frames = new Map<string, HTMLIFrameElement>();

function visibilityOf(windowId: string): WindowVisibility {
  const visible = frames.has(windowId) && document.visibilityState === 'visible';
  return { visible, focused: visible && document.hasFocus() };
}

function describe(prompt: ConsentPrompt): string {
  const lines = prompt.summary.lines.map((line) => `${line.label}: ${line.before ?? '-'} -> ${line.after ?? '-'}`);
  return [prompt.summary.title, ...lines].join('\n');
}

const host: KernlHost = {
  storage: localStorage,
  presentConsent: (prompt) => prompt.resolve(window.confirm(describe(prompt))),
  notify: (notice) => {
    status.textContent = `${notice.title}${notice.body ? `: ${notice.body}` : ''}`;
  },
  openLink: (url) => void window.open(url, '_blank', 'noopener,noreferrer'),
  getVisibility: visibilityOf,
  onRevoked(windowId, reason) {
    frames.get(windowId)?.remove();
    frames.delete(windowId);
    status.textContent = `The applet was stopped (${reason}).`;
  },
};

const kernl = createKernl({ host });
window.addEventListener('message', (event) => kernl.handleWindowMessage(event));
status.textContent = `Shell ready. Guard profile: ${kernl.guard.config.profile}.`;
```

`createKernl` creates the event store, the connection pool, the account manager, the guard in its `strict` profile and kehto's shell bridge. The `message` listener is how an applet's first message reaches the guard and then the bridge; add it exactly once.

**Checkpoint.** Reload the page. The status line reads "Shell ready. Guard profile: strict." and the console has no errors.

## 4. Sign in read-only

Applets can see who is at the keyboard. A read-only account is the simplest way to have one: it needs only a public key, and every write an applet asks for is refused because there is no signer. Add to `main.ts`:

<!-- sample:continues -->
```ts
import { ReadonlyAccount } from 'applesauce-accounts/accounts';

async function signIn(pubkey: string): Promise<void> {
  if (kernl.session?.pubkey === pubkey) return;
  const session = await kernl.login(ReadonlyAccount.fromPubkey(pubkey));
  status.textContent = `Signed in as ${session.label} (read-only: ${session.readOnly}).`;
}
```

**Checkpoint.** Nothing changes yet; the function is called in the next step.

## 5. Resolve, plan and mount

This is the whole applet lifecycle: turn the address into a pointer, fetch and verify the applet, record grants, plan the mount, attach an empty frame and hand it to kernl. Add to `main.ts`:

<!-- sample:continues -->
```ts
const form = document.querySelector<HTMLFormElement>('#open')!;
const container = document.querySelector<HTMLDivElement>('#frames')!;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  void open(String(data.get('pubkey') ?? '').trim(), String(data.get('address') ?? '').trim());
});

async function open(pubkey: string, address: string): Promise<void> {
  try {
    if (pubkey) await signIn(pubkey);
    status.textContent = 'Looking up the applet…';
    const summary = await kernl.resolve(kernl.decodePointer(address));
    status.textContent = `Verified "${summary.title}" (build ${summary.identity.hash.slice(0, 8)}).`;

    const plan = await kernl.plan(summary);
    if (plan.missingRequired.length > 0) status.textContent += ` Runs without: ${plan.missingRequired.join(', ')}.`;

    const frame = document.createElement('iframe');
    frame.title = summary.title;
    container.append(frame); // attached and empty: mount needs its contentWindow
    frames.set(plan.windowId, frame);
    const handle = kernl.mount(plan, frame);
    handle.status$.subscribe((state) => {
      if (state === 'running') status.textContent = `"${summary.title}" is running in ${plan.windowId}.`;
    });
  } catch (error) {
    status.textContent = `Could not open it: ${(error as Error).message}`;
  }
}
```

`resolve` verifies the manifest's signature and hashes the applet's code before anything runs; a failure is a stable reason such as `invalid:pointer` or `unavailable:manifest` ([Error reasons](../reference/errors.md)). `plan` writes the applet's grants explicitly, so it sees only the baseline domains until you allow more. `mount` sets the frame's `sandbox` attribute to exactly `allow-scripts`, registers the window, and only then assigns the verified `srcdoc`. Do not set `src`, `sandbox` or `srcdoc` yourself.

**Checkpoint.** Paste any public key (64 hex characters) and an applet address, then click **Open**. The address below is a puzzle game published by a third party on napplet.run, not by kernl; it needs no grants:

```
naddr1qvzqqqyf8ypzqw49s9e88sajl985jxzquprj7pyapugqp83rme3sqctxhj5mxm4rqythwumn8ghj7un9d3shjtnwv9c8qmr9wsh8xmmeqqxkuttzvy6nyefnxpjr2e3jqg5uk8
```

You should see "Signed in as …", then "Looking up the applet…", then `Verified "Freeze Frame Response" (build b5633add)`, and finally `"Freeze Frame Response" is running in applet-1.` with the game in the frame. The build prefix changes if the publisher releases a new version. "Could not open it: unavailable:manifest" means no connection returned the applet's description; check your network and try again.

## 6. Watch the guard

The guard reports what it notices about each applet as events. Add to `main.ts`:

<!-- sample:continues -->
```ts
const log = document.querySelector<HTMLPreElement>('#events')!;

kernl.guard.events$.subscribe((event) => {
  log.textContent += `${new Date(event.at).toLocaleTimeString()} ${event.windowId} ${event.disposition} ${event.reason}\n`;
});
document.addEventListener('visibilitychange', () => {
  for (const handle of kernl.applets()) handle.setVisibility(visibilityOf(handle.windowId));
});
```

**Checkpoint.** A quiet applet produces no events, so the log stays empty while you play. Switch to another tab and back: the guard now knows the window was hidden, and a hidden applet that keeps downloading past its allowance would be quarantined and reported as `flood:hidden-resource`. What each reason means is in [Guard](../concepts/guard.md#dispositions-and-reasons).

## What you built

A page that is a complete kernl host: it verifies an applet before running it, runs it in a frame with no network of its own, keeps the guard informed, and stops the applet when the guard quarantines it. Two things this page leaves out on purpose:

- **Signing.** A read-only account cannot sign, so the consent prompt never appears. With a signing account, an applet that tries to change your profile, follows, connections or lists, or to delete something, reaches `presentConsent` first, and a "no" fails the write with `denied:consent`.
- **Grants.** The page never calls `kernl.grants.allowDomain`, so applets get only the baseline. [Grant and revoke](../how-tos/grant-and-revoke.md) shows the calls.

## Where next

- [Embed kernl core](../how-tos/embed-kernl-core.md): the same host with grants and focus tracking.
- [Run the shell](./run-the-shell.md): the full shell in `apps/web`.
- [Applets under kernl](../concepts/applets-under-kernl.md): what the guard expects of an applet.
