<div align="center">

<br />

<img src="apps/web/public/mark.svg" width="88" height="88" alt="" />

# kernl

**An opinionated shell for sandboxed applets, built on [kehto](https://github.com/kehto/web).**

The person at the keyboard is the only principal that matters.

[![CI](https://github.com/kernlize/web/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kernlize/web/actions/workflows/ci.yml)
[![Pages](https://github.com/kernlize/web/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/kernlize/web/actions/workflows/pages.yml)
[![AI Slop Score](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fkernlize%2Fweb%2Fbadges%2Faislop-score.json)](https://github.com/kernlize/web/actions/workflows/aislop-badge.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0b0b0b.svg)](./LICENSE)

[Website](https://kernlize.github.io/web/) · [Docs](https://kernlize.github.io/web/docs/) · [Open the shell](https://kernlize.github.io/web/app/) · [Why](https://kernlize.github.io/web/why/)

<br />

</div>

> **Alpha.** kernl is a first draft. The guard, the messaging and bridge contracts, the composition over kehto and the shell UI are real and tested. Torrent, NZB, Soulseek and mail backends are contracts without implementations. Read [`docs/alpha-status.md`](./docs/alpha-status.md) before relying on anything.

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

## Packages

| Package | Purpose | Docs |
|---|---|---|
| [`@kernl/guard`](./packages/guard) | Ingress flood control, visibility gating, focus-aware firewall, CSP profile, mitigation descriptions. Pure. | [guard](./docs/packages/guard.md) |
| [`@kernl/messaging`](./packages/messaging) | Provider contract, registry, composite direct-message adapter, three providers. Pure. | [messaging](./docs/packages/messaging.md) |
| [`@kernl/bridges`](./packages/bridges) | Locator parsing, bridge contract, registry, HTTP bridge with SSRF policy, backend interfaces. Pure. | [bridges](./docs/packages/bridges.md) |
| [`@kernl/core`](./packages/core) | Composition root over kehto and applesauce: adapters, applet resolution, mount plan, consent summaries, layouts. | [core](./docs/packages/core.md) |

Published packages have zero framework dependencies and never import `nostr-tools` directly. A guard test enforces both.

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

```bash
pnpm install
pnpm build
pnpm site:dev        # landing site and shell
pnpm docs:dev        # documentation
```

Open the shell, sign in with a browser extension or a remote signer, and paste an applet address.

## Check it

```bash
pnpm check
```

That runs, in order: build, type-check, features with 100% coverage, dependency rules, docs gate, site build, public-vocabulary scan, agent-readiness audit, slop gate. All of them must pass before a PR is opened.

## How behaviour is specified

Every behaviour is a Gherkin scenario before it is code.

```gherkin
Feature: Hidden windows wait their turn
  Scenario: a hidden applet asks for bytes
    Given a guard configured with the "strict" profile
    And window "w1" is hidden
    When window "w1" sends a "resource.bytes" envelope
    Then the guard defers it
    And the deferred envelope is delivered when "w1" becomes visible
```

Features live in `packages/*/features/` and run inside vitest through [quickpickle](https://github.com/dnotes/quickpickle). Coverage thresholds are 100% across statements, branches, functions and lines.

## Documentation

The docs are a product. Start at [`docs/index.md`](./docs/index.md), or on the site at [/docs/](https://kernlize.github.io/web/docs/). Agents can read [`/llms.txt`](https://kernlize.github.io/web/llms.txt) and [`/docs/llms.txt`](https://kernlize.github.io/web/docs/llms.txt); every page has a Markdown twin.

| Need | Page |
|---|---|
| Understand the layering | [Architecture](./docs/concepts/architecture.md) |
| Understand what protects the user | [Guard](./docs/concepts/guard.md) |
| Understand grants and identity | [Identity and grants](./docs/concepts/identity-and-grants.md) |
| Run the shell locally | [Run the shell](./docs/tutorials/run-the-shell.md) |
| Build an applet for kernl | [Build an applet](./docs/tutorials/build-an-applet-for-kernl.md) |
| Add a messaging provider | [How-to](./docs/how-tos/add-a-messaging-provider.md) |
| Add a bridge backend | [How-to](./docs/how-tos/add-a-bridge-backend.md) |
| Browse the API | [Reference](./docs/reference/api.md) |

## Relationship to the ecosystem

- [kehto](https://github.com/kehto/web) supplies the runtime, shell adapter, services, ACL, firewall and NIP-5D verification. kernl composes them and files gaps upstream rather than forking.
- The applet format is [NIP-5D](https://github.com/nostr-protocol/nips/pull/2303) with per-domain [NAPs](https://github.com/napplet/naps). Applet-side packages live at [napplet](https://github.com/sandwichfarm/napplet).
- [applesauce](https://applesauce.build) is the event layer.

## Contributing

Read [`AGENTS.md`](./AGENTS.md). It is written for agents and applies to people. Branch per concern, specify behaviour before code, keep docs in the same PR, keep the slop gate at 100.

## License

MIT
