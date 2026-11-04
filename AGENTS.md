# AGENTS.md

Source of truth for agents working in this repository. `CLAUDE.md` is a symlink to it. Read `SOUL.md` first for what kernl is, and `DECISIONS.md` for why the code is shaped the way it is.

## Orientation

```bash
git status && git branch --show-current && git log --oneline -5
pnpm install
pnpm build && pnpm type-check && pnpm test
```

Finish interrupted work before starting new work. Never discard changes you did not make; stash them with a message instead.

## Repository map

| Path | Workspace | Purpose |
|---|---|---|
| `packages/guard` | `@kernl/guard` | Ingress flood control, visibility gate, focus-aware firewall, CSP profile, mitigation descriptions |
| `packages/messaging` | `@kernl/messaging` | Messaging provider contract, registry, composite NAP-DM adapter |
| `packages/bridges` | `@kernl/bridges` | Locator parsing, bridge contract, registry, HTTP bridge with SSRF policy |
| `packages/core` | `@kernl/core` | Composition root over kehto and applesauce: adapters, applet resolution, mount plan, consent summaries, layouts, persistence |
| `apps/web` | `@kernl/web` | Astro site at `/`, shell at `/app/` |
| `docs` | `@kernl/docs` | VitePress site at `/docs/` |
| `scripts` | | Build, audit and guard scripts |
| `features` | | Cross-package behaviour specs |

## Working rules

### Branch and commit

- Never work on `main`. One `<type>/<slug>` branch per concern. Worktrees go under `~/.worktrees/kernl/<branch-slug>`.
- Conventional Commits, small and atomic, staged by explicit path. Trailer: `Co-Authored-By:` for the authoring agent.
- "Done" means build, type-check, tests, coverage, docs gate and slop gate are green, commits are pushed, and a PR is open.

### Spec before code

- Protocol authority is the canonical NIP-5D text in `nostr-protocol/nips` PR #2303 and the NAP documents in `napplet/naps`. Keep no local copy. When a NAP is ambiguous, record the gap next to the code and prefer an upstream issue over inventing wire format.
- kehto is the runtime authority for how a shell composes. Read the kehto source for the seam you are touching before writing an adapter; the kehto tutorial lags its code.
- Every behaviour is a Gherkin scenario in `features/` before it is an implementation. A scenario you cannot write is a design you have not finished.

### No drift

Code, features, step definitions and docs change in the same PR.

- `pnpm test` must stay green with 100% coverage over `packages/*/src`.
- Every public export has JSDoc with `@param`, `@returns` and `@example`, and a reference page reachable from the docs sidebar. `pnpm docs:check` enforces a page per package with a `| Version | \`x.y.z\` |` row.
- `pnpm check:vocabulary` fails if `apps/web` output names a protocol. Public copy says applet, account, network, provider, guard.
- `pnpm check:agent-ready` fails if the built site is missing any agent-discovery artifact.
- `pnpm slop` must score 100. `.aislop/config.yml` is pinned; disabling a rule needs a written reason in the config.

### Code conventions

- TypeScript strict, ESM only, `verbatimModuleSyntax`, 2-space indent.
- Kebab-case filenames, PascalCase types, camelCase functions, UPPER_SNAKE constants.
- Published packages have zero framework dependencies and import nothing from `nostr-tools` directly.
- Streams from `@kernl/core` are rxjs Observables (unsubscribe the `Subscription`); `MessagingBackend.subscribe` returns `{ subscriptionId }`, released with `unsubscribe(id)`. Errors carry a stable, prefixed reason (`denied:`, `invalid:`, `unavailable:`).
- No decorative comments. A comment explains a decision a reader could not infer, and cites the spec clause or `DECISIONS.md` entry when one exists.
- Functions under 120 lines, files under 600, nesting under 4, at most 5 parameters. These are the slop gate's limits.

### Security posture

- Applets load through `srcdoc` only, with `sandbox="allow-scripts"`, the guard's CSP, and `denyNappletControllerAccess`. Never `src`, never `allow-same-origin`.
- Verified bytes come from `@kehto/nip/5d` `resolveNapplet`. Gateways and caches are accelerators, never identity.
- Mount order is register → set environment → observe frame → assign `srcdoc`. Remove the iframe on every revocation reason.
- Keys live only inside applesauce signer instances. kernl never serialises a private key outside `PasswordAccount`.
- Secrets never appear in logs, guard events or consent summaries.

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Build every package through turbo |
| `pnpm type-check` | `tsc --noEmit` everywhere |
| `pnpm test` | Features and unit tests with coverage thresholds |
| `pnpm test:e2e` | Playwright against the built site |
| `pnpm docs:dev` / `pnpm docs:check` | VitePress dev server / docs gate |
| `pnpm site:dev` / `pnpm site:build` | Astro dev server / full Pages artifact in `.pages/` |
| `pnpm check:vocabulary` | Public-copy denylist scan |
| `pnpm check:agent-ready` | Agent-discovery artifact audit |
| `pnpm slop` | aislop scan |
| `pnpm check` | Everything above that runs without a browser |

## Releases

Changesets. Add one per package whose shipped output changed; on 0.x a breaking change is a `minor` bump. `publish.yml` opens the Version Packages PR through `pnpm version-packages`, which also rewrites the `| Version |` rows in `docs/packages/` so the docs gate passes; `release.yml` is the only publisher.

## Private references

Some design input came from private repositories. Do not name them in code, docs, commits or issues. Lessons are recorded in `DECISIONS.md` without attribution.
