# Deploy

kernl deploys as one static artifact: the landing site at the root, the shell at `/app/`, the docs at `/docs/` and the generated API reference at `/docs/api/`. `scripts/build-pages.mjs` assembles it into `.pages/`, and GitHub Pages serves it. No server-side code is involved.

## The three variables

| Variable | Used by | Meaning | Default | Pages value |
| --- | --- | --- | --- | --- |
| `SITE_URL` | Astro site, docs `llms.txt` | Absolute URL of the deployment root. Canonical tags, sitemap, JSON-LD and the absolute links in `llms.txt` are derived from it. | `https://kernlize.github.io/` | `https://kernlize.github.io/` |
| `SITE_BASE` | Astro site | Path prefix the site is served under. | `/` | `/` |
| `VITEPRESS_BASE` | Docs site | Path prefix the docs are served under. Always `SITE_BASE` plus `docs/`. | `/docs/` | `/docs/` |

The Pages workflow reads `SITE_URL` and `SITE_BASE` from repository variables (`vars.SITE_URL`, `vars.SITE_BASE`) and falls back to the domain root: `https://kernlize.github.io/` and `/`. It sets `VITEPRESS_BASE` to `SITE_BASE` followed by `docs/`. When a custom domain is chosen, set those two variables; nothing in the source references a host ([D-008](../decisions.md#d-008)).

## Serve at a domain root

The site is served at the root of its own origin, **https://kernlize.github.io/**, because agent-readiness scanners grade the origin: they read `robots.txt` and `llms.txt` from the domain root whatever path they are given, and a project subpath such as `kernlize.github.io/web/` has neither ([D-013](../decisions.md#d-013)).

The source repository is private, so it does not serve Pages itself. The built `.pages/` artifact is published to the public `kernlize/kernlize.github.io` repository, which holds nothing else. Publishing is manual by decision ([D-013](../decisions.md#d-013)): one command builds, runs the vocabulary and agent-readiness gates, and pushes the artifact.

```bash
pnpm site:publish
```

`.github/workflows/pages.yml` builds and audits the same artifact on every push to `main`. It publishes only if a `SITE_PUBLISH_TOKEN` secret (a fine-grained token with Contents read/write on `kernlize/kernlize.github.io`) is ever added; none is configured.

To move to a custom domain, set the `SITE_URL` repository variable to `https://<domain>/`, keep `SITE_BASE` at `/`, and add a `CNAME` file to the published artifact. GitHub Pages cannot answer `Accept: text/markdown`; a host that should needs a rule that serves the page's `.md` twin with `Vary: Accept`. `scripts/serve-pages.mjs` implements the rule and is the reference.

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
  VITEPRESS_BASE: ${{ vars.SITE_BASE || '/' }}docs/
steps:
  - run: pnpm install --frozen-lockfile
  - run: pnpm site:build
  - run: pnpm check:vocabulary
  - run: pnpm check:agent-ready
  - name: Publish to kernlize/kernlize.github.io   # needs SITE_PUBLISH_TOKEN
```

`pnpm site:build` includes the docs gate, so a deployment with a missing package page, a missing Markdown twin or a broken TypeDoc module does not happen. `pnpm check:vocabulary` and `pnpm check:agent-ready` run in the same workflow against `.pages/`.

## TypeDoc source links

`typedoc.json` sets `packageOptions.disableSources`, so the generated reference carries no links into the source repository, which is private during the alpha, and TypeDoc never consults a git remote. Because `entryPointStrategy` is `packages`, command-line flags such as `--disableSources` do not reach the per-package converters; set source options under `packageOptions`. When the repository opens, replace it with a `sourceLinkTemplate` pointing at the public tree. Without either option, TypeDoc looks up the `origin` remote and, if there is none, warns; `treatWarningsAsErrors` turns that into a failed `pnpm docs:api` ([Troubleshooting](../guides/troubleshooting.md#typedoc-fails-on-the-git-remote)).

## Hosting somewhere else

Any static host works. Set `SITE_URL` to the deployment root, `SITE_BASE` and `VITEPRESS_BASE` to its path prefix (usually `/` and `/docs/`), build, and upload `.pages/`. The shell has no server dependency; the applets it opens come from relays the user chose.
