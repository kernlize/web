# Minimal host

A page with its own UX on kernl's kernel, built only from the published packages: `@kernlize/kernel` and two modules from `@kernlize/modules`. It has no Svelte, no store and no window manager. It opens one applet, pinned by hash, and asks the person everything in its own dialog.

- **Composition:** `createKernel({ host, builtins: [NOTE], modules: [messagingModule({ providers: [privateDm()] }), filesModule()] })`, in [`src/main.ts`](src/main.ts).
- **The applet:** [`public/applet.html`](public/applet.html), a single-file napplet that sends a private message (`dm`) and uploads a file (`upload`). The build hashes it, and the kernel refuses any bytes that do not hash to that pin.
- **Asks:** the host renders `upload.file` in its own `<dialog>` ([`src/ask.ts`](src/ask.ts)). Any other kind of question is refused without asking.
- **Messages and uploads:** an applet that reads messages has uploads withheld (D-046). The host's opening question lets the person keep uploads anyway, and that choice is the person's alone (D-060).

## Run it

It is not part of the pnpm workspace, so it installs from npm like anyone else's app:

```sh
cd examples/minimal-host
npm ci
npm run dev
```

`npm run build` writes `dist/`, which any static server can serve. Its end-to-end test is `tests/e2e/minimal-host.spec.ts`, which runs against relays and file servers that exist only in the browser under test; from the repository root, `pnpm example:build && pnpm exec playwright test --project minimal-host`.
