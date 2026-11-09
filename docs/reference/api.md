# API reference

The API reference is generated from source JSDoc by TypeDoc 0.28 with `entryPointStrategy: packages` over the four workspaces in `typedoc.json`. It is written to `docs/api/` and served next to this site at `/docs/api/`.

```bash
pnpm docs:api
```

Do not edit the generated files. Fix the JSDoc in `packages/*/src` and rerun. `treatWarningsAsErrors` is on, so an export without documentation or a broken `{@link}` fails the build. The reference has no source links: `typedoc.json` sets `packageOptions.disableSources: true`, because the source repository is private during the alpha. Read the source in a clone instead.

## Modules

| Package | Module page |
| --- | --- |
| `@kernlize/guard` | [`_kernlize_guard`](../api/modules/_kernlize_guard.html){target="_self"} |
| `@kernlize/messaging` | [`_kernlize_messaging`](../api/modules/_kernlize_messaging.html){target="_self"} |
| `@kernlize/bridges` | [`_kernlize_bridges`](../api/modules/_kernlize_bridges.html){target="_self"} |
| `@kernlize/core` | [`_kernlize_core`](../api/modules/_kernlize_core.html){target="_self"} |

The [index page](../api/index.html){target="_self"} lists all four, and the [hierarchy page](../api/hierarchy.html){target="_self"} shows type relationships across them.

## How to read it

- Each module page lists its exports by kind: interfaces, type aliases, functions, variables. Every entry has at least one `@example`.
- Reasons in thrown errors are documented as string literals (`denied:…`, `invalid:…`, `unavailable:…`) on the function that throws them.
- Types imported from `@kehto/*` or `@napplet/core` are linked to their names but not expanded; `excludeExternals` keeps the reference to kernl's own surface.
- The reference is HTML only. It has no Markdown twin and is not included in `llms-full.txt`; the [package pages](../packages/index.md) carry the export lists in Markdown for agents.

## Audit

`scripts/audit-docs.mjs` asserts that `docs/api/modules/_kernlize_<package>.html` exists for every `packages/*/package.json`, that each package page links to it, and that the built docs carry their Markdown twins. It also reads every built page and checks that each `href` into `api/` resolves, under `VITEPRESS_BASE` (default `/docs/`), to a file TypeDoc wrote; that is why the links on this page are relative (`../api/…`). It runs as part of `pnpm docs:check`.
