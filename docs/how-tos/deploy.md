# Deploy

kernl deploys as one static artifact: the landing site at the root, the shell at `/app/`, the docs at `/docs/` and the generated API reference at `/docs/api/`. `scripts/build-pages.mjs` assembles it into `.pages/`, and GitHub Pages serves it. No server-side code is involved.

## The three variables

| Variable | Used by | Meaning | Default | Pages value |
| --- | --- | --- | --- | --- |
| `SITE_URL` | Astro site, docs `llms.txt` | Absolute URL of the deployment root. Canonical tags, sitemap, JSON-LD and the absolute links in `llms.txt` are derived from it. | `https://kernlize.github.io/` | `https://kernlize.github.io/` |
| `SITE_BASE` | Astro site | Path prefix the site is served under. | `/` | `/` |
| `VITEPRESS_BASE` | Docs site | Path prefix the docs are served under. Always `SITE_BASE` plus `docs/`. | `/docs/` | `/docs/` |

The Pages workflow reads `SITE_URL` and `SITE_BASE` from repository variables (`vars.SITE_URL`, `vars.SITE_BASE`) and falls back to the project subpath. When a custom domain is chosen, set those two variables; nothing in the source references a host (D-008).

## Serve at a domain root

Agent-readiness scanners such as amiagentready score the **origin**: they read the domain's homepage, `robots.txt` and `llms.txt` at the root, whatever path they are given (D-013). Measured on 2026-11-03:

| Hosting | `robots.txt` / `llms.txt` at the root | `Accept: text/markdown` | Score |
| --- | --- | --- | --- |
| Domain root, host negotiates Markdown (`scripts/serve-pages.mjs`) | yes | yes | **92** |
| Domain root, plain static host | yes | no | 90 |
| Project subpath `kernlize.github.io/web/` | no | no | about 82 |

So production is a domain root: **https://kernlize.github.io/**, scored **90** live on 2026-11-03 (no failing checks; GitHub Pages cannot negotiate Markdown). The source repository is private and on the free plan, so it cannot serve Pages itself. The built `.pages/` artifact is published to the public `kernlize/kernlize.github.io` repository, which holds nothing else.

`.github/workflows/pages.yml` builds, audits and publishes on every push to `main`. Publishing needs one repository secret, `SITE_PUBLISH_TOKEN`: a fine-grained personal access token scoped to `kernlize/kernlize.github.io` with **Contents: read and write**. Without it the job still builds and audits, then stops. Organisation deploy keys are disabled for `kernlize`, which is why the workflow uses a token.

To publish by hand:

```bash
pnpm site:build
git clone git@github.com:kernlize/kernlize.github.io.git site
find site -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R .pages/. site/ && cd site && git add -A && git commit -m "Publish kernl site" && git push
```

Moving to a custom domain later means setting the `SITE_URL` and `SITE_BASE` repository variables and adding a `CNAME` to the published artifact. With GitHub Pages that means a custom domain (set the variables to `https://<domain>/` and `/`). Content negotiation needs a host or edge rule that, for a request with `Accept: text/markdown`, serves the page's `.md` twin with `Vary: Accept`. `scripts/serve-pages.mjs` implements the rule and is the reference.

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

The server resolves directory URLs to `index.html` and VitePress clean URLs to their `.html` file, answers `Accept: text/markdown` with the page's Markdown twin (`Vary: Accept`), serves `.md` as `text/markdown` and `.txt` as `text/plain`, and refuses paths outside the artifact.

## Publish workflow

`.github/workflows/pages.yml` runs on pushes to `main`:

```yaml
env:
  SITE_URL: ${{ vars.SITE_URL || 'https://kernlize.github.io/' }}
  SITE_BASE: ${{ vars.SITE_BASE || '/' }}
steps:
  - run: pnpm install --frozen-lockfile
  - run: pnpm site:build
  - run: pnpm check:vocabulary
  - run: pnpm check:agent-ready
  - name: Publish to kernlize/kernlize.github.io   # needs SITE_PUBLISH_TOKEN
```

`pnpm site:build` includes the docs gate, so a deployment with a missing package page, a missing Markdown twin or a broken TypeDoc module does not happen. `pnpm check:vocabulary` and `pnpm check:agent-ready` run in the same workflow against `.pages/`.

## TypeDoc source links

TypeDoc derives source links from the git remote named `origin`. In a checkout with commits but without that remote it warns once per package, and `typedoc.json` sets `treatWarningsAsErrors`, so `pnpm docs:api` fails. CI checkouts have the remote. Locally, add it (`git remote add origin https://github.com/kernlize/web.git`). Because `entryPointStrategy` is `packages`, command-line flags such as `--disableSources` do not reach the per-package converters; a configuration that never depends on the remote sets `packageOptions.sourceLinkTemplate` to `https://github.com/kernlize/web/blob/main/{path}#L{line}` in `typedoc.json`.

## Hosting somewhere else

Any static host works. Set `SITE_URL` to the deployment root, `SITE_BASE` and `VITEPRESS_BASE` to its path prefix (usually `/` and `/docs/`), build, and upload `.pages/`. The shell has no server dependency; the applets it opens come from relays the user chose.
