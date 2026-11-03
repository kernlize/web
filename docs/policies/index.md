# Policies

Rules the repository enforces mechanically. Each policy names the script that checks it and the decision in `DECISIONS.md` that motivates it. A policy that cannot be checked by a script is a convention, and conventions live in `AGENTS.md`, not here.

| Policy | Checked by | Decision |
| --- | --- | --- |
| [Public vocabulary](./public-vocabulary.md) | `pnpm check:vocabulary` (`scripts/check-public-vocabulary.mjs`) | [D-006](../decisions.md#d-006) |
| [Security posture](./security-posture.md) | `packages/*/features/` scenarios, `pnpm check:deps`, Playwright in `pnpm test:e2e` | [D-001](../decisions.md#d-001), [D-002](../decisions.md#d-002), [D-003](../decisions.md#d-003) |
| [Spec conformance](./spec-conformance.md) | `packages/*/features/` scenarios; review. Running `@napplet/conformance` in the suite is [roadmap](../roadmap.md#_7-conformance) work. | `AGENTS.md` "Spec before code" |

Two further gates apply to everything, including these pages:

- **Docs gate.** `pnpm docs:check` builds TypeDoc and VitePress, then runs `scripts/audit-docs.mjs`: a page per package with its version row, every page in the sidebar, a TypeDoc module per package, `llms.txt`, `llms-full.txt` and a Markdown twin per built page.
- **Slop gate.** `pnpm slop` runs aislop over the repository and `scripts/assert-slop-score.mjs` fails below 100. Functions under 120 lines, files under 600, nesting under 4, at most 5 parameters, no narrative comments.
