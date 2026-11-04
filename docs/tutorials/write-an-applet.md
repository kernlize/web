# Write an applet

This tutorial builds a small applet as one HTML file, checks it against the limits kernl will hold it to, publishes it with the applet format's own tooling, and opens it in kernl. The applet shows who is signed in when it is allowed to know, lists recent notes when it is allowed to read the network, and posts a note. It takes about thirty minutes, most of it in publishing.

kernl adds nothing to the applet format, so nothing here is kernl-specific except the last two steps. The authority on the format is [napplet.run](https://napplet.run/docs/), the [getting-started guide](https://napplet.run/docs/guide/getting-started.html) and the [NAP documents](https://github.com/napplet/naps). [Applets under kernl](../concepts/applets-under-kernl.md) explains the posture your applet meets; this page is the hands-on version.

::: warning Alpha
kernl is a first draft, and so is the protocol. Step 3 needs a clone of the kernl source repository, which is private during the alpha ([Packages](../packages/index.md#install)); the other steps do not.
:::

## Prerequisites

- A text editor and a browser.
- The `napplet` CLI for publishing. Install it with `curl -fsSL https://napplet.run/install.sh | sh` (Windows: `irm https://napplet.run/install.ps1 | iex`), then check it with `napplet --version`.
- A key to sign the applet's manifest with. `napplet deploy` asks for one when it has none: a remote signer, a stored reference or a pasted secret.

## 1. Write the applet

Create a folder `hello-kernl` with one file, `index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hello kernl</title>
  <meta name="description" content="Shows who is signed in, lists recent notes and posts one.">
  <meta name="napplet-id" content="hello-kernl">
  <meta name="napplet-optional" content="identity relay">
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 1.5rem; }
    li { margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>Hello kernl</h1>
  <p id="who">Waiting for the shell…</p>
  <section id="network" hidden>
    <form id="post">
      <input id="text" placeholder="Say something" required>
      <button>Post</button>
    </form>
    <ul id="notes"></ul>
  </section>
  <p id="status" role="status"></p>
  <script type="module">
    const napplet = window.napplet;
    const status = (text) => { document.getElementById('status').textContent = text; };

    if (!napplet?.shell) {
      status('Open this page in an applet shell, such as kernl.');
    } else {
      await napplet.shell.ready();

      const who = document.getElementById('who');
      if (napplet.shell.supports('identity')) {
        const pubkey = await napplet.identity.getPublicKey();
        who.textContent = pubkey ? `Signed in as ${pubkey.slice(0, 8)}…` : 'Nobody is signed in.';
      } else {
        who.textContent = 'Allow your account to see who is signed in.';
      }

      if (napplet.shell.supports('relay')) {
        document.getElementById('network').hidden = false;
        const list = document.getElementById('notes');
        const seen = new Set();
        napplet.relay.subscribe({ kinds: [1], limit: 10 }, ({ event }) => {
          if (seen.has(event.id)) return;
          seen.add(event.id);
          const item = document.createElement('li');
          item.textContent = event.content.slice(0, 280);
          list.prepend(item);
        }, () => status('Up to date.'));

        document.getElementById('post').addEventListener('submit', async (submit) => {
          submit.preventDefault();
          const input = document.getElementById('text');
          try {
            await napplet.relay.publish({ kind: 1, content: input.value, tags: [], created_at: Math.floor(Date.now() / 1000) });
            input.value = '';
            status('Posted.');
          } catch (error) {
            status(`Not posted: ${error.message}`);
          }
        });
      } else {
        status('Allow network access to see and post notes.');
      }
    }
  </script>
</body>
</html>
```

What each part does:

- **The `<meta>` tags are publishing hints.** `napplet deploy` reads `description`, `napplet-id` (the applet's name in its address) and `napplet-optional`, a space-separated list of domains, from the head and signs them into the manifest. `identity` and `relay` are optional here, not required, because the applet still does something without them. A domain listed in `napplet-requires` would be marked "the applet says it needs this" in kernl's launcher. Neither grants anything: the user decides.
- **`window.napplet` is the whole API.** The shell injects it before your code runs; the applet loads no library. Outside a shell it is missing, which is why the script checks `napplet?.shell` first. `@napplet/sdk` wraps the same object in typed named exports if you prefer a bundler ([`@napplet/sdk`](https://www.npmjs.com/package/@napplet/sdk)).
- **Feature detection, not assumption.** `napplet.shell.supports('relay')` is true only when the shell put `relay` on `window.napplet`, which in kernl means the user granted it. The same holds for `identity`: kernl's baseline is `shell`, `inc`, `theme` and `storage`, so an applet is not told who is signed in until the user grants "your account". Check `supports('identity')` before you read it, and say what the grant would add.
- **`shell.ready()`** waits for the shell's answer to the applet's `hello`, so the domains are settled before the applet reads them.
- **Routine writes only.** A kind 1 note is routine, so kernl signs it without a prompt. If your applet updated the user's profile (kind 0) or deleted something (kind 5), kernl would show the user what changes and wait; a refusal arrives as an error that names `denied:consent`.
- **Errors are shown, not thrown away.** A publish the shell refuses fails with an error, for example one starting `firewall:` or `denied:`, and the applet prints it. A publish kernl drops for going over its budget gets no reply at all ([D-020](../decisions.md#d-020)); at one post per click this applet never gets near the budget.
- **No frames, no Trusted Types policy of its own.** The list is built with `createElement` and `textContent`. kernl refuses to mount markup that contains an `iframe`, `object`, `embed` or other frame element, makes every attempt to create one throw `denied:nested-frame`, and reserves the Trusted Types `default` policy for that lock, so an applet must not create a frame or register a Trusted Types policy ([Applets under kernl](../concepts/applets-under-kernl.md#what-the-strict-profile-means-for-you)).

The file has no network access of its own and needs none: inline script and style are allowed, and everything else goes through the shell ([No network path](../concepts/guard.md#no-network-path)).

**Checkpoint.** Open `index.html` directly in a browser. You should see "Hello kernl" and "Open this page in an applet shell, such as kernl." Nothing else happens, because there is no shell.

## 2. Know the limits it will meet

Under kernl's `strict` profile, which every load starts in, the limits that matter for this applet are:

| What the applet does | Limit in `strict` | What happens past it |
| --- | --- | --- |
| Posts notes (`relay.publish`) | 20 per 60 s per applet | kernl drops the publish with no reply; the runtime enforces the same budget with a `firewall:` error for requests it handles |
| Reads the network (`relay.subscribe`) | 30 per 60 s | dropped the same way |
| Sends messages to the shell in its first second | 8 | kehto's runtime firewall refuses the rest of the burst with a `firewall:` error |
| Sends messages to the shell at all | 8 per second | requests past it are dropped with no reply; control messages still pass |
| Is not the focused window | 25% of each rate above | dropped with no reply until it is focused |
| Asks for anything while hidden, other than control messages | 200 held | held, and answered once the window is visible; past 200, dropped with no reply |
| Sends messages to the shell at all | 300 in any 10 s | the applet is quarantined: the message that crossed the limit is dropped and the applet is closed |
| Downloads while hidden (`resource.*`) | 8 | the ninth quarantines the applet |
| Asks for a download or a query larger than the cap | 64 KiB for `resource.*`, 256 KiB for subscriptions and queries | dropped before it is handled, with no reply |

This applet sends a handful of messages at start-up, opens one subscription and publishes once per click, so it stays far inside every limit. The full list is in [Guard](../concepts/guard.md#profiles).

## 3. Test it against the guard

kernl's guard is a pure package, so you can replay your applet's traffic through it in a test, without a browser, and see which events the user would see. This needs the kernl source ([Packages](../packages/index.md#install)). The function below feeds the guard each message the way the shell does: the ingress guard counts it first, and the focus firewall measures it unless it was held or quarantined.

```ts
import { createFocusFirewall, createGuardConfig, createIngressGuard, type GuardEnvelope, type GuardEvent } from '@kernl/guard';

const events: GuardEvent[] = [];
let clock = 0;
const config = createGuardConfig('strict');
const options = { config, now: () => clock, onEvent: (event: GuardEvent) => events.push(event) };
const ingress = createIngressGuard(options);
const firewall = createFocusFirewall(options);

function send(envelope: GuardEnvelope, visibility = { visible: true, focused: true }): string {
  const disposition = ingress.admit('w1', 'hello-kernl', envelope, visibility);
  if (disposition === 'pass') firewall.observe('w1', 'hello-kernl', envelope, visibility);
  return disposition;
}

// Start-up: the readiness signal, the identity read and the one subscription.
send({ type: 'shell.ready' });
send({ type: 'identity.getPublicKey' });
send({ type: 'relay.subscribe', size: 120 });

// A user, or a bug, that posts once a second for a minute.
const firstReport: number[] = [];
for (let post = 1; post <= 60; post += 1) {
  clock += 1000;
  const before = events.length;
  send({ type: 'relay.publish', kind: 1, size: 300 });
  if (events.length > before) firstReport.push(post);
}

const reasons = new Set(events.map((event) => event.reason));
// Start-up is quiet. From about the 30th post on, the posts outrun the
// 20-per-minute budget: `reasons` is { 'rate:relay:publish' } and `firstReport[0]`
// is near 30. In the shell, kehto's runtime firewall, which kernl configures
// with the same rates, refuses those posts.
```

Change the loop to model your own applet: a burst of subscriptions on start-up, a hidden window (`send(envelope, { visible: false, focused: false })`) or a background poll. What `events` holds is what the guard panel would show the user. [Applets under kernl](../concepts/applets-under-kernl.md#test-against-the-guard) adds the visibility gate and lists scenarios worth writing.

To see the applet run inside a real shell runtime on your machine, the napplet CLI can serve it in kehto's Paja preview (`napplet paja`, see the [CLI reference](https://napplet.run/docs/)). Paja runs the same kehto runtime kernl composes, without kernl's opinions: it is a quick way to check the applet's behaviour, not kernl's guard.

## 4. Publish it

Publishing signs a manifest that names your file by its hash, uploads the file to a Blossom server and announces the manifest on relays. kernl verifies the hash before anything runs, so the bytes it runs are exactly the bytes you published.

From the `hello-kernl` folder:

```bash
napplet init --source-dir . --name hello-kernl --title "Hello kernl" --relay wss://relay.napplet.soy --server https://blossom.example
napplet deploy --dry-run
napplet deploy
```

Replace `https://blossom.example` with a Blossom server you can upload to; `napplet init` without flags suggests some. `wss://relay.napplet.soy` is the relay in kernl's applet catalogue tier by default, so kernl finds the manifest there without extra settings. `napplet deploy --dry-run` shows the plan and the signed manifest without uploading anything; `napplet deploy` does the upload and prints the applet's address, an `naddr1…` string. Copy it.

If you build with Vite instead of writing one file by hand, `@napplet/vite-plugin` inlines your code into a single `index.html` and writes the same manifest fields from its options (`nappletType`, `requires`, `optional`); `napplet create` starts such a project. The [napplet.run docs](https://napplet.run/docs/) cover both paths.

**Checkpoint.** `napplet deploy` reports the upload and the publish as complete and prints an `naddr1…` address.

## 5. Open it in kernl

Open the shell, either the hosted one at `https://kernlize.github.io/app/` or your own from [Run the shell](./run-the-shell.md), and sign in. The offline preview (`?preview=1`) cannot open your applet: it has no network and runs only its two sample applets.

1. Click **Open an applet**, paste the address into "Applet address" and click **Look up**. kernl fetches the manifest, verifies its signature, fetches your file by hash and verifies it.
2. The launcher shows the title, publisher and description, and under "What it may use" switches for *your account* and *network*, each marked "optional" and off. Click **Run** with both off first.
3. The window shows "Allow your account to see who is signed in." and "Allow network access to see and post notes." That is your feature detection at work.
4. Click the window's **Grants** button and turn *your account* and *network* on. The grant applies to the running window's next request, but the domains an applet was told about at start-up do not change until it is opened again, so close the window and open the applet again from "Recent" in the launcher.
5. Now the window shows "Signed in as …", the notes appear, and **Post** works without a prompt.

If you published to a relay that is not in kernl's catalogue tier and the address carries no relay hint, the lookup finds nothing: add the relay under **Settings**, "Applet catalogue", "Server address", and try again.

**You should now see** your applet in a window titled "Hello kernl", and *Guard · strict · 0* in the bar: a well-behaved applet triggers no guard events. Click it to see the protections and, if you push the applet past a limit, the events it caused, each naming your applet.

## Where next

- [Applets under kernl](../concepts/applets-under-kernl.md) for every limit and how the guard treats hidden and unfocused windows.
- [Guard](../concepts/guard.md) for the numbers in all three profiles.
- [Identity and grants](../concepts/identity-and-grants.md) for what changes when you publish a new build: a new hash is a new identity with no grants.
- [Troubleshooting](../guides/troubleshooting.md) when the launcher says it cannot find or verify your applet.
