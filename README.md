<div align="center">

<br />

<img src="apps/web/public/favicon.svg" width="72" height="72" alt="" />

# kernl

**An opinionated shell for sandboxed applets, built on [kehto](https://github.com/kehto/web).**

The person at the keyboard is the only principal that matters.

![status: alpha](https://img.shields.io/badge/status-alpha-efb449)
![package coverage: 100%](https://img.shields.io/badge/package%20coverage-100%25-0b0b0b)
![slop gate: 100 (clean)](https://img.shields.io/badge/slop%20gate-100%20(clean)-0b0b0b)
![agent readiness: 90](https://img.shields.io/badge/agent%20readiness-90-0b0b0b)
[![license: MIT](https://img.shields.io/badge/license-MIT-0b0b0b)](./LICENSE)

[**Try the shell**](https://kernlize.github.io/app/?preview=1) · [Website](https://kernlize.github.io/) · [Docs](https://kernlize.github.io/docs/) · [Why](https://kernlize.github.io/why/)

<br />

</div>

> **Alpha.** kernl is a first draft. The guard, the messaging and bridge contracts, the composition over kehto and the shell UI are real and tested. Torrent, NZB, Soulseek and mail backends are contracts without implementations. Read [`docs/alpha-status.md`](./docs/alpha-status.md) before relying on anything.
>
> The source is private during alpha; the [site and docs](https://kernlize.github.io/) are public, and the `@kernl/*` packages are not on npm yet. The badges above are measured values from `pnpm check` and a live agent-readiness scan, not live CI status: package coverage is statement, branch, function and line coverage over `packages/*/src`, and the slop gate is the `aislop` score (100 means no findings).

<p align="center">
  <img src=".github/assets/shell.png" alt="The kernl shell in its tiled layout: two sandboxed preview applets side by side, one granted network access and one not, with the guard indicator reading strict." width="880" />
</p>

## What it is

kehto is an unopinionated set of packages for building a NIP-5D applet shell. It does not pick a relay library, a signer, a consent model, a layout or a deployment story. kernl picks all of them, and writes each choice down.

| kehto leaves open | kernl decides |
|---|---|
| Event layer | [applesauce](https://applesauce.build) v7, and nothing else |
| Security posture | Every mitigation kehto offers, on by default, strict profile |
| Grants | Restrictive. Applets see what the user granted, keyed by verified artifact hash |
| Consent | Writes are shown as what they change, not as JSON |
| Messaging | Any reasonable private-message protocol, described truthfully, never ranked |
| Other protocols | Bridged to one identity layer and named by what they do: downloads, sharing, mail |
| Public voice | The website never names a protocol. Protocols are plumbing; the person is the point |

The full reasoning is in [`SOUL.md`](./SOUL.md). Each concrete choice is in [`DECISIONS.md`](./DECISIONS.md).

## What it does

- **Runs applets in a sealed frame.** `srcdoc`, `sandbox="allow-scripts"` and nothing else, a zero-network policy, identity bound to the verified bytes and a single message port. When any of that changes, the binding is revoked and the frame removed; grants stay keyed by the applet's identity, so the same build gets them back when it is opened again.
- **Asks before it signs anything destructive.** When an applet asks to sign a profile edit, a follow change, a deletion, a connection-list change or a list change, kernl's consent gate (in the signer it hands kehto, and in front of the outbox service) shows it as before → after, with the raw event behind a disclosure, and waits. A refusal fails with `denied:consent` and nothing is signed. Routine writes are signed without a prompt, and no answer is remembered.
- **Guards by default.** Eleven protections ship on, in the strict profile, with a readable list of what is on and why. Before an applet's message is dispatched, kehto's runtime firewall enforces the per-class rates kernl installs. kernl's flood control, hidden-window and focus tracking and size caps watch the same traffic after dispatch: they report what they see and quarantine a flooding applet, but they do not hold or drop single messages ([D-012](./DECISIONS.md)). The profile is shell-wide and resets to strict on boot; per-applet profiles are planned.
- **Messages across providers (preview only in this alpha).** One Direct Messenger surface over several private-message providers, each described by its properties and none ranked. In the live shell all three providers are unavailable because no backend is supplied; only the offline preview sends messages. See [`docs/alpha-status.md`](./docs/alpha-status.md).
- **Bridges other networks.** Web fetch works today behind an SSRF policy, with caveats: from the browser shell it works for `https` origins that permit cross-origin reads, redirects are refused because the browser hides their target, and hostnames are checked as literals only. Downloads, sharing and mail have their contracts and wait for backends.
- **Previews without an account.** `/app/?preview=1` runs the whole shell offline with sample applets that exercise consent, notifications and the guard.

<p align="center">
  <img src=".github/assets/guard.png" alt="The guard panel in the preview: the strict, balanced and relaxed profiles with strict selected, all eleven protections in plain words with their strict limits and whether each is built into the toolkit or added by kernl, and an empty recent-events log." width="520" />
</p>

## Packages

| Package | Purpose | Docs |
|---|---|---|
| [`@kernl/guard`](./packages/guard) | Ingress flood control, visibility gating, focus-aware firewall, CSP profile, mitigation descriptions. Pure. | [guard](./docs/packages/guard.md) |
| [`@kernl/messaging`](./packages/messaging) | Provider contract, registry, composite direct-message adapter, three providers. Pure. | [messaging](./docs/packages/messaging.md) |
| [`@kernl/bridges`](./packages/bridges) | Locator parsing, bridge contract, registry, HTTP bridge with SSRF policy, backend interfaces. Pure. | [bridges](./docs/packages/bridges.md) |
| [`@kernl/core`](./packages/core) | Composition root over kehto and applesauce: adapters, applet resolution, mount plan, consent summaries, layouts. | [core](./docs/packages/core.md) |

Published packages have zero framework dependencies and never import `nostr-tools` directly. `pnpm check:deps` (`scripts/check-dependency-rules.mjs`) enforces both.

## Layout

```
packages/guard        @kernl/guard        pure
packages/messaging    @kernl/messaging    pure
packages/bridges      @kernl/bridges      pure
packages/core         @kernl/core         kehto + applesauce composition
apps/web              @kernl/web          Astro site at /, shell at /app/
docs                  @kernl/docs         VitePress at /docs/
scripts               build, audit and guard scripts
```

## Run it

No install: [open the preview](https://kernlize.github.io/app/?preview=1). It runs the whole shell in your browser with sample applets and a throwaway account.

From source (Node 22 or newer, pnpm 10 via `corepack enable`):

```bash
git clone git@github.com:kernlize/web.git kernl && cd kernl   # access required during alpha
pnpm install
pnpm build           # the site imports the built packages
pnpm site:dev        # landing site and shell
pnpm docs:dev        # documentation
```

Open the URL `pnpm site:dev` prints, `http://localhost:4321/app/` by default, sign in with a browser extension, a remote signer or a local account, and paste an applet's address.

## Check it

```bash
pnpm check
```

That runs, in order: build, type-check, features with 100% coverage, dependency rules, docs gate, site build, public-vocabulary scan, agent-readiness audit, slop gate. `pnpm test:e2e` adds the browser suite, and `PLAYWRIGHT_BASE_URL=https://kernlize.github.io pnpm exec playwright test` runs it against the live site. `pnpm site:publish` publishes.

## How behaviour is specified

Every behaviour is a Gherkin scenario before it is code. This is an excerpt from [`packages/guard/features/visibility.feature`](./packages/guard/features/visibility.feature); the omitted scenarios are marked with `# …`:

```gherkin
Feature: Visibility gate
  Hidden windows should not fetch or publish while the user cannot see them.
  Their traffic waits and is drained when they return; control messages are
  never held so a hidden window can still be closed or themed.

  Background:
    Given a guard visibility gate using the "strict" profile

  # … two scenarios on what the gate believes about visibility

  Scenario: hidden windows defer everything except control
    When the guard gate marks window "w1" as "hidden"
    Then the guard gate defers "relay:subscribe" for window "w1"
    And the guard gate defers "resource:bytes" for window "w1"
    And the guard gate does not defer "control" for window "w1"

  # … seven more scenarios: visible windows, draining, the full queue, forgetting a window
```

The scenarios specify the gate's own API. In the composed shell the gate holds only an applet's first window-level message; the rest of its traffic travels over a port kehto owns and is observed after dispatch.

Features live in `packages/*/features/` and run inside vitest through [quickpickle](https://github.com/dnotes/quickpickle). Coverage thresholds are 100% across statements, branches, functions and lines.

## Documentation

The docs are a product. Start at [`docs/index.md`](./docs/index.md), or on the site at [/docs/](https://kernlize.github.io/docs/). Agents can read [`/llms.txt`](https://kernlize.github.io/llms.txt) and [`/docs/llms.txt`](https://kernlize.github.io/docs/llms.txt); every page has a Markdown twin, except the generated API reference, which is HTML only.

| Need | Page |
|---|---|
| Understand the layering | [Architecture](./docs/concepts/architecture.md) |
| Understand what protects the user | [Guard](./docs/concepts/guard.md) |
| Understand grants and identity | [Identity and grants](./docs/concepts/identity-and-grants.md) |
| Run the shell locally | [Run the shell](./docs/tutorials/run-the-shell.md) |
| Write an applet that runs well under kernl | [Applets under kernl](./docs/concepts/applets-under-kernl.md) |
| Embed the shell core in your own page | [Embed `@kernl/core`](./docs/how-tos/embed-kernl-core.md) |
| Add a messaging provider | [How-to](./docs/how-tos/add-a-messaging-provider.md) |
| Add a bridge backend | [How-to](./docs/how-tos/add-a-bridge-backend.md) |
| Look up an error reason | [Errors](./docs/reference/errors.md) |
| Browse the API | [Reference](./docs/reference/api.md) |

## Relationship to the ecosystem

- [kehto](https://github.com/kehto/web) supplies the runtime, shell adapter, services, ACL, firewall and NIP-5D verification. kernl composes them and records upstream gaps (to be filed) instead of forking; see [`DECISIONS.md`](./DECISIONS.md) D-001.
- The applet format is [NIP-5D](https://github.com/nostr-protocol/nips/pull/2303) with per-domain [NAPs](https://github.com/napplet/naps). Applet-side packages and the format's own site live at [napplet.run](https://napplet.run).
- [applesauce](https://applesauce.build) is the event layer.

## Contributing

Read [`AGENTS.md`](./AGENTS.md). It is written for agents and applies to people. Branch per concern, specify behaviour before code, keep docs in the same PR, keep the slop gate at 100.

## License

MIT
