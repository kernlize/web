# Troubleshooting

The failures people actually hit with this draft, what each one looks like, and what fixes it. Reason strings are listed in [Error reasons](../reference/errors.md).

## `pnpm site:dev` before `pnpm build`

**Symptom.** The dev server starts, but the shell at `/app/` fails to load: Vite reports that it cannot resolve an `@kernlize/…` import, or the shell opens the preview with the notice "Running the preview: The live shell could not start (…)".

**Cause.** `apps/web` depends on the four packages with `workspace:^`, and each package's `exports` point at `dist/index.js`. A fresh clone has no `dist/`; `pnpm install` links the packages but does not build them.

**Fix.** Build once, then start the site. Rebuild after changing a package.

```bash
pnpm install
pnpm build
pnpm site:dev
```

## TypeDoc fails on the git remote

**Symptom.** `pnpm docs:api` (and therefore `pnpm docs:check` and `pnpm site:build`) stops with `The provided git remote "origin" was not valid. Source links will be broken`, raised to an error by `treatWarningsAsErrors` in `typedoc.json`.

**Cause.** When neither `disableSources` nor `sourceLinkTemplate` is configured, TypeDoc derives source links from the remote named `origin` and warns when it is missing.

**Fix.** The repository's `typedoc.json` sets `packageOptions.disableSources: true`, which makes TypeDoc skip the remote lookup and leaves the reference without source links ([API reference](../reference/api.md)); if you see the warning, check that a local change did not remove it. `entryPointStrategy` is `packages`, so command-line flags such as `--disableSources` do not reach the per-package converters; set options under `packageOptions`. Alternatively add the remote with `git remote add origin <url>`.

## `localStorage` warnings under Node 25 and later

**Symptom.** Running `pnpm test` prints `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.`, or a test that uses `localStorage` throws because it is `undefined`.

**Cause.** Newer Node versions define a global `localStorage` that is empty unless Node is started with `--localstorage-file`. On Node 26, reading it prints the warning and returns `undefined`. kehto's shell persists its ACL and manifest cache through `localStorage`.

**Fix.** Nothing, for the shipped suites: `packages/core/features/steps/world.ts` installs an in-memory `localStorage` when the global has no `getItem`, and the warning is harmless. In your own tests, pass a `StorageLike` (a `Map` behind `getItem`, `setItem` and `removeItem`) as `KernlHost.storage`, and install a stand-in before importing kehto if your test reaches its persistence.

## An address does not open

**Symptom.** The launcher shows a sentence under the address field instead of the applet.

**Cause and fix.** Each sentence is one reason:

- "That does not look like an applet address." (`invalid:pointer`): the text holds no address. A link with the address in it is fine; a link to a page about the applet is not.
- "No applet was found at that address." (`unavailable:manifest`): the servers answered and none has it, including the general servers the shell falls back to. Add the server that does under **Settings**, in the applet catalogue tier, or use an address that names it.
- "None of the servers that list applets could be reached." (`unavailable:network`): none of the servers the address names, the applet catalogue or the general servers answered; the shell gives each group ten seconds. Check the connection, a VPN or a content blocker that stops secure socket connections, then look it up again.
- "The applet was found, but its file could not be downloaded right now." (`unavailable:blob`): the servers named by the applet did not return its file.
- "Could not open the applet. Try again, or try another address.": the shell had no reason for the failure, which is a defect. The browser console has a line starting `kernl: an applet could not be opened for an unexpected reason` with the underlying error; include it in the report.

To check a published applet end to end, the way a person would open it, run `KERNL_PUBLIC_NETWORK=1 pnpm exec playwright test tests/e2e/shell-live-network.spec.ts` after adding its address to that file.

## An applet opens but never gets past its first screen

**Symptom.** The window shows the applet, which waits forever, shows its own "not available" state, or gets refusals.

**Cause.** A domain the applet `requires` is not granted. kernl never grants a domain because an applet asked for it: the launcher shows the required domains as switches that start off, warns "Without …, this applet may not work. You can still run it.", and `plan.missingRequired` names what is missing. The applet's `shell.init` lists only the baseline and the domains you turned on.

**Fix.** Open the window's **Grants** panel and turn the domain on. The grant reaches the ACL at once, but the domains the applet was told about at mount do not change until it is opened again, so close the window and open the applet again. A domain the shell does not offer cannot be switched on: the launcher lists it disabled as "not available in this shell", and it has no switch in the grants panel (for example `config`, `intent` or `upload`; see [Architecture](../concepts/architecture.md#where-each-nap-domain-is-served-from)), and the applet cannot get it in kernl. A new build of an applet has a new hash, so it starts with no grants; see [Applets under kernl](../concepts/applets-under-kernl.md).

## An applet was quarantined

**Symptom.** A notice says "… was stopped", the window shows "This applet was stopped." with the reason `quarantine`, and the guard panel (*Guard · strict · N*) lists "Applet … was quarantined: it kept flooding the shell" (`flood:quarantine`) or "…: too many web fetches while hidden" (`flood:hidden-resource`).

**Cause.** The applet sent more messages than the profile allows in the rolling window, or used up its `resource.*` allowance while hidden. The guard revokes the applet's binding and removes its frame; the guard state for that window is dropped.

**Fix.** A stopped window does not restart. The window's **Grants** panel offers **Release from quarantine**, which calls `kernl.guard.release(windowId)` and clears the window's quarantine mark; to run the applet again, close the stopped window and open the applet again. It gets a fresh window and fresh guard counters, and its grants are unchanged, because quarantine does not block. If it floods again, either block it (**Block applet**) or, for an applet you trust, switch the guard panel's profile; that applies to every window and resets to `strict` on reload ([Change the guard profile](../how-tos/change-guard-profile.md)).
