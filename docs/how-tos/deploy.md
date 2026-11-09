# Deploy

kernl deploys as one static artifact: the landing site at the root, the shell at `/app/`, the docs at `/docs/` and the generated API reference at `/docs/api/`. `scripts/build-pages.mjs` assembles it into `.pages/`, and a bunny.net static site serves it at **https://kernl.run/** ([D-019](../decisions.md#d-019)). No server-side code is involved.

## The three variables

| Variable | Used by | Meaning | Default | kernl.run value |
| --- | --- | --- | --- | --- |
| `SITE_URL` | Astro site, docs `llms.txt` | Absolute URL of the deployment root. Canonical tags, sitemap, JSON-LD and the absolute links in `llms.txt` are derived from it. | `https://kernl.run/` | `https://kernl.run/` |
| `SITE_BASE` | Astro site | Path prefix the site is served under. | `/` | `/` |
| `VITEPRESS_BASE` | Docs site | Path prefix the docs are served under. Always `SITE_BASE` plus `docs/`. | `/docs/` | `/docs/` |

The Publish site workflow reads `SITE_URL` and `SITE_BASE` from repository variables (`vars.SITE_URL`, `vars.SITE_BASE`) and falls back to the domain root: `https://kernl.run/` and `/`. It sets `VITEPRESS_BASE` to `SITE_BASE` followed by `docs/`. When a custom domain is chosen, set those two variables; nothing in the source references a host ([D-008](../decisions.md#d-008)).

## Serve at a domain root

The site is served at the root of its own origin, **https://kernl.run/**, because agent-readiness scanners grade the origin: they read `robots.txt` and `llms.txt` from the domain root whatever path they are given, and a project subpath has neither ([D-013](../decisions.md#d-013)).

The host is a bunny.net static site named `kernl`: a storage zone holding one immutable directory per deploy and a pull zone whose edge rule points at the live one ([D-019](../decisions.md#d-019)). The domain's DNS points `kernl.run` at the pull zone's `b-cdn.net` host.

### One-time setup

```bash
bunny login
bunny sites create kernl --no-link --domain kernl.run   # once per account
scripts/setup-bunny-secrets.sh                          # safe to re-run
```

`scripts/setup-bunny-secrets.sh` reads the API key from `BUNNYNET_API_KEY` or the bunny CLI profile, checks it and the site, and sets the `BUNNYNET_API_KEY` secret and the `BUNNY_SITE`, `SITE_URL` and `SITE_BASE` variables on the repository. It never prompts, so every run converges on the same state; variables are written only when they differ. Override any value through the environment (`BUNNY_SITE`, `SITE_URL`, `SITE_BASE`, `BUNNY_PROFILE`) or pass `owner/repo` as the first argument.

### Publishing

Every push to `main` deploys. To deploy from a checkout instead:

```bash
pnpm site:publish
```

That builds, runs the vocabulary and agent-readiness gates, and runs `bunny sites deploy .pages --site kernl`. A deploy whose content is already live is a no-op. To roll back:

```bash
bunny sites deployments list kernl
bunny sites deployments publish --previous --force
```

bunny.net does not answer `Accept: text/markdown` by itself; a host that should needs a rule that serves the page's `.md` twin with `Vary: Accept`. `scripts/serve-pages.mjs` implements the rule and is the reference; on bunny.net it would be a middleware Edge Script on the pull zone, which is not set up yet.

## Build locally

```bash
pnpm site:build
```

This runs, in order: `pnpm build` (packages), `pnpm docs:check` (TypeDoc, VitePress, the docs audit), the Astro build, then `node scripts/build-pages.mjs`. The result is `.pages/`:

```
.pages/
├── index.html            landing
├── about/                long-form pages
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
  SITE_URL: ${{ vars.SITE_URL || 'https://kernl.run/' }}
  SITE_BASE: ${{ vars.SITE_BASE || '/' }}
  VITEPRESS_BASE: ${{ vars.SITE_BASE || '/' }}docs/
steps:
  - run: pnpm install --frozen-lockfile
  - run: pnpm site:build
  - run: pnpm check:vocabulary
  - run: pnpm check:agent-ready
  - name: Deploy to bunny.net   # BunnyWay/actions/deploy-site, needs BUNNYNET_API_KEY
```

`pnpm site:build` includes the docs gate, so a deployment with a missing package page, a missing Markdown twin or a broken TypeDoc module does not happen. `pnpm check:vocabulary` and `pnpm check:agent-ready` run in the same workflow against `.pages/`. Without the `BUNNYNET_API_KEY` secret the workflow builds, audits and stops with a notice. Deploys are never cancelled in flight, since that would leave a half-written deploy directory.

## TypeDoc source links

`typedoc.json` sets `packageOptions.disableSources`, so the generated reference carries no links into the source repository, which is private during the alpha, and TypeDoc never consults a git remote. Because `entryPointStrategy` is `packages`, command-line flags such as `--disableSources` do not reach the per-package converters; set source options under `packageOptions`. When the repository opens, replace it with a `sourceLinkTemplate` pointing at the public tree. Without either option, TypeDoc looks up the `origin` remote and, if there is none, warns; `treatWarningsAsErrors` turns that into a failed `pnpm docs:api` ([Troubleshooting](../guides/troubleshooting.md#typedoc-fails-on-the-git-remote)).

## Hosting somewhere else

Any static host works. Set `SITE_URL` to the deployment root, `SITE_BASE` and `VITEPRESS_BASE` to its path prefix (usually `/` and `/docs/`), build, and upload `.pages/`. The shell has no server dependency; the applets it opens come from relays the user chose.
