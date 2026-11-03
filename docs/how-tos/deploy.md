# Deploy

kernl deploys as one static artifact: the landing site at the root, the shell at `/app/`, the docs at `/docs/` and the generated API reference at `/docs/api/`. `scripts/build-pages.mjs` assembles it into `.pages/`, and GitHub Pages serves it. No server-side code is involved.

## The three variables

| Variable | Used by | Meaning | Default | Pages value |
| --- | --- | --- | --- | --- |
| `SITE_URL` | Astro site, docs `llms.txt` | Absolute URL of the deployment root. Canonical tags, sitemap, JSON-LD and the absolute links in `llms.txt` are derived from it. | `https://kernlize.github.io/web/` | `https://kernlize.github.io/web/` |
| `SITE_BASE` | Astro site | Path prefix the site is served under. | `/` | `/web/` |
| `VITEPRESS_BASE` | Docs site | Path prefix the docs are served under. Always `SITE_BASE` plus `docs/`. | `/docs/` | `/web/docs/` |

The Pages workflow reads `SITE_URL` and `SITE_BASE` from repository variables (`vars.SITE_URL`, `vars.SITE_BASE`) and falls back to the project subpath. When a custom domain is chosen, set those two variables; nothing in the source references a host (D-008).

## Serve at a domain root

Agent-readiness scanners such as amiagentready score the **origin**: they read the domain's homepage, `robots.txt` and `llms.txt` at the root, whatever path they are given (D-013). Measured on 2026-11-03:

| Hosting | `robots.txt` / `llms.txt` at the root | `Accept: text/markdown` | Score |
| --- | --- | --- | --- |
| Domain root, host negotiates Markdown (`scripts/serve-pages.mjs`) | yes | yes | **92** |
| Domain root, plain static host | yes | no | 90 |
| Project subpath `kernlize.github.io/web/` | no | no | about 82 |

So production should be a domain root. With GitHub Pages that means a custom domain (set the variables to `https://<domain>/` and `/`). Content negotiation needs a host or edge rule that, for a request with `Accept: text/markdown`, serves the page's `.md` twin with `Vary: Accept`. `scripts/serve-pages.mjs` implements the rule and is the reference.

To re-measure a build without deploying it, serve `.pages/` with `scripts/serve-pages.mjs`, expose it on a temporary public URL, and request `https://amiagentready.com/api/scan?url=<url>`. Add a query string to bypass the scanner's cache.

## Build locally

```bash
pnpm site:build
```

This runs, in order: `pnpm build` (packages), `pnpm docs:check` (TypeDoc, VitePress, the docs audit), the Astro build, then `node scripts/build-pages.mjs`. The result is `.pages/`:

```
.pages/
├── index.html            landing site
├── app/                  shell
├── llms.txt              site index (Astro)
├── docs/
│   ├── index.html        VitePress
│   ├── llms.txt          docs index
│   ├── llms-full.txt
│   ├── **/*.md           Markdown twins
│   └── api/              TypeDoc
└── .nojekyll
```

`build-pages.mjs` fails if any input is missing, so a half-built artifact is never produced. `PAGES_OUT_DIR` overrides the output directory.

## Preview the artifact

```bash
pnpm site:preview
```

`scripts/serve-pages.mjs` serves `.pages/` on `http://127.0.0.1:4178/`. To preview under the Pages prefix exactly as deployed:

```bash
SITE_BASE=/web/ VITEPRESS_BASE=/web/docs/ pnpm site:build
PAGES_PREVIEW_PATH=/web/ pnpm site:preview
# → http://127.0.0.1:4178/web/
```

The server resolves directory URLs to `index.html`, serves `.md` as `text/markdown` and `.txt` as `text/plain`, and refuses paths outside the artifact.

## GitHub Pages workflow

The workflow in `.github/workflows/pages.yml` runs on pushes to `main`:

```yaml
env:
  SITE_URL: https://kernlize.github.io/web/
  SITE_BASE: /web/
  VITEPRESS_BASE: /web/docs/
steps:
  - uses: pnpm/action-setup@v4
  - run: pnpm install --frozen-lockfile
  - run: pnpm site:build
  - uses: actions/upload-pages-artifact@v3
    with: { path: .pages }
  - uses: actions/deploy-pages@v4
```

`pnpm site:build` includes the docs gate, so a deployment with a missing package page, a missing Markdown twin or a broken TypeDoc module does not happen. `pnpm check:vocabulary` and `pnpm check:agent-ready` run in the same workflow against `.pages/`.

## TypeDoc source links

TypeDoc derives source links from the git remote named `origin`. In a checkout with commits but without that remote it warns once per package, and `typedoc.json` sets `treatWarningsAsErrors`, so `pnpm docs:api` fails. CI checkouts have the remote. Locally, add it (`git remote add origin https://github.com/kernlize/web.git`). Because `entryPointStrategy` is `packages`, command-line flags such as `--disableSources` do not reach the per-package converters; a configuration that never depends on the remote sets `packageOptions.sourceLinkTemplate` to `https://github.com/kernlize/web/blob/main/{path}#L{line}` in `typedoc.json`.

## Hosting somewhere else

Any static host works. Set `SITE_URL` to the deployment root, `SITE_BASE` and `VITEPRESS_BASE` to its path prefix (usually `/` and `/docs/`), build, and upload `.pages/`. The shell has no server dependency; the applets it opens come from relays the user chose.
