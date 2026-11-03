# Embed kernl core

`apps/web` is one host for `@kernl/core`; your own page can be another. This how-to implements `KernlHost`, calls `createKernl`, and mounts an applet in an iframe you own. The sample is type-checked with `strict` on by `node scripts/check-doc-samples.mjs`, part of `pnpm docs:check`. For a slower, step-by-step version with a complete page, follow the tutorial [Embed kernl in a page](../tutorials/embed-a-host-page.md).

The packages are not yet published to npm, so your page lives in a clone of the kernl source as a workspace package that depends on `@kernl/core` and `@kernl/guard` with `workspace:^`, and you run `pnpm build` first ([Packages](../packages/index.md#install)).

## 1. Put the frame policy in the page head

The host page must stop applet frames from navigating away from their verified `srcdoc`. `KERNL_FRAME_POLICY_META` is the `<meta>` element that does it, rendered once by kehto's `renderNappletFramePolicyMeta`:

```html
<meta http-equiv="Content-Security-Policy" content="frame-src 'none'">
```

Put it in the `<head>` of the HTML the server sends, before any script runs, as `apps/web/src/pages/app/index.astro` does. If your page is generated, render the constant into the head at build time (`import { KERNL_FRAME_POLICY_META } from '@kernl/core'`) rather than inserting it from client code, so the policy is in force before the first frame exists. Applets still load, because their bytes arrive as `srcdoc` rather than from a URL; a frame that tries to load or navigate to a URL is blocked.

## 2. Implement `KernlHost` and create the shell

`KernlHost` is the only way the core reaches the user or the page. Six members are required:

| Member | What the core expects |
| --- | --- |
| `storage` | A synchronous `StorageLike` (`getItem`, `setItem`, `removeItem`). `localStorage` satisfies it. Grants, accounts, relay tiers and messaging preferences persist here under `kernl:` keys. |
| `presentConsent(prompt)` | Called when an applet window asks to sign, through `relay.publish` or `outbox.publish`, a destructive change (profile, follows, deletions, connections list, lists). `prompt.summary.event` is the unsigned draft. Show `prompt.summary` (title, lines) and call `prompt.resolve(true \| false)`. `false`, which you also send on dismiss, makes signing fail with `denied:consent`. The core never times out. Routine writes never reach this hook. |
| `notify(notice)` | Show `{ title, body?, windowId?, tone }`. Applets reach it through the `notify` domain; the guard and revocations use it too. |
| `openLink(url)` | Open a URL outside the shell. It is called only after the link service allowed the protocol (`https:`, `mailto:`); confirming with the user is your choice. |
| `getVisibility(windowId)` | Current visibility for a window, when the core needs it synchronously: return `{ visible, focused, msSinceFocusGain? }`. The guard asks the first time it meets a window you have not reported with `handle.setVisibility`; after that it uses what you report. |
| `onRevoked(windowId, reason)` | Called after the core removed a frame because its binding was revoked (`quarantine`, `second-load`, …). Update your UI. |

`fetchBlob` and `now` are optional; without them the core fetches artifact blobs with `defaultFetchBlob` and uses `Date.now`.

```ts
import { createKernl, type AppletHandle, type ConsentPrompt, type KernlHost } from '@kernl/core';
import type { WindowVisibility } from '@kernl/guard';
import { ReadonlyAccount } from 'applesauce-accounts/accounts';

const frames = new Map<string, HTMLIFrameElement>();
let focusedId: string | null = null;

function visibilityOf(windowId: string): WindowVisibility {
  const frame = frames.get(windowId);
  const visible = frame !== undefined && frame.isConnected && document.visibilityState === 'visible';
  return { visible, focused: visible && focusedId === windowId };
}

function describe(prompt: ConsentPrompt): string {
  const lines = prompt.summary.lines.map((line) => `${line.label}: ${line.before ?? '-'} -> ${line.after ?? '-'}`);
  return [prompt.summary.title, ...lines].join('\n');
}

const host: KernlHost = {
  storage: localStorage,
  presentConsent: (prompt) => prompt.resolve(window.confirm(describe(prompt))),
  notify: (notice) => console.info(`[${notice.tone}] ${notice.title}${notice.body ? `: ${notice.body}` : ''}`),
  openLink: (url) => void window.open(url, '_blank', 'noopener,noreferrer'),
  getVisibility: visibilityOf,
  onRevoked(windowId, reason) {
    frames.get(windowId)?.remove();
    frames.delete(windowId);
    console.warn(`applet ${windowId} was stopped: ${reason}`);
  },
};

const kernl = createKernl({ host });
window.addEventListener('message', (event) => kernl.handleWindowMessage(event));

function refreshVisibility(): void {
  for (const handle of kernl.applets()) handle.setVisibility(visibilityOf(handle.windowId));
}
document.addEventListener('visibilitychange', refreshVisibility);

export async function signInReadOnly(pubkey: string): Promise<void> {
  const session = await kernl.login(ReadonlyAccount.fromPubkey(pubkey));
  console.info(`signed in as ${session.label}, read-only: ${session.readOnly}`);
}

export async function openApplet(address: string, container: HTMLElement): Promise<AppletHandle> {
  const summary = await kernl.resolve(kernl.decodePointer(address));
  const offered = kernl.grants.availableDomains();
  const baseline = kernl.grants.baselineDomains();
  for (const domain of summary.requires) {
    if (!offered.includes(domain) || baseline.includes(domain)) continue;
    if (window.confirm(`${summary.title} says it needs "${domain}". Allow it?`)) kernl.grants.allowDomain(summary.identity, domain);
  }
  const plan = await kernl.plan(summary);
  if (plan.missingRequired.length > 0) console.warn(`${summary.title} runs without ${plan.missingRequired.join(', ')}`);

  const frame = document.createElement('iframe');
  frame.title = summary.title;
  container.append(frame);
  frames.set(plan.windowId, frame);
  container.addEventListener('pointerdown', () => {
    focusedId = plan.windowId;
    refreshVisibility();
  });
  return kernl.mount(plan, frame);
}
```

`createKernl({ host })` creates one `EventStore`, one `RelayPool` and one `AccountManager`, the guard pipeline in `strict`, the default messaging and bridge registries, kehto's services and the shell bridge ([`@kernl/core`](../packages/core.md#composition)). Pass any of them in `KernlOptions` to use your own. Wire `handleWindowMessage` to `window` exactly once: it is how an applet's `hello` reaches the guard and then kehto.

## 3. The mount flow

`openApplet` above is the whole lifecycle, and the order matters:

1. **`decodePointer(address)`** turns the address into a pointer and throws `invalid:pointer` for anything else.
2. **`resolve(pointer)`** fetches the manifest from the pointer's relay hints plus the `apps` tier and verifies the signature and the artifact bytes. The `AppletSummary` it returns is what you show before running anything; `requires` and `optional` are advisory.
3. **Grants.** Ask the user, then call `grants.allowDomain(identity, domain)` for what they allowed. Skip domains outside `grants.availableDomains()`, which throw `invalid:domain`, and the baseline ones, which are always on.
4. **`plan(summary)`** writes the applet's ACL explicitly and returns the `MountPlan`: the srcdoc with the guard's CSP, the environment the applet will see, and `missingRequired`. It throws `denied:blocked` for a blocked applet.
5. **The frame.** Create the iframe and attach it to the document first: `mount` needs its `contentWindow` and throws `invalid:frame-detached` otherwise. Do not set `src`, `sandbox` or `srcdoc` yourself. Record it under `plan.windowId` so `getVisibility` can answer for it.
6. **`mount(plan, frame)`** installs the profile's runtime rates, sets the `sandbox` attribute to exactly `allow-scripts` (replacing anything you set) and the controller-denying `allow` policy, registers the window, and only then assigns `srcdoc`. It returns an `AppletHandle`.

After mount, keep the guard informed: call `handle.setVisibility(...)` whenever a window is shown, hidden, focused or blurred (the sample does it on `visibilitychange` and on pointer focus). `handle.close()` revokes the binding and removes the frame; grants stay, keyed by identity. `kernl.destroy()` closes everything when the page goes away.

## 4. Check it

- Open an applet that `requires` `relay` and decline it: `plan.missingRequired` is `['relay']` and the applet's `shell.init` lacks it.
- Hide its container and call `setVisibility`: from then on the applet's resource requests count against the hidden allowance, and an overrun quarantines the window and appears on `kernl.guard.events$`.
- Have the applet publish a profile change: `presentConsent` is called with the title "Update your profile". Answer `false` and the applet's publish fails with `denied:consent`.
- Subscribe to `kernl.guard.events$` and `kernl.session$` and render them; they are the same streams `apps/web` shows in its guard panel and sign-in screen.

## Related

- [Run the shell](../tutorials/run-the-shell.md), the same flow through `apps/web`
- [Applets under kernl](../concepts/applets-under-kernl.md)
- [Architecture](../concepts/architecture.md#the-mount-path)
- [Error reasons](../reference/errors.md)
