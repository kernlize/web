# Publish packages

The four packages publish to two registries from the same commit and versions:

| Directory | npm | JSR |
| --- | --- | --- |
| `packages/bridges` | `@kernlize/bridges` | `@kernl/bridges` |
| `packages/core` | `@kernlize/core` | `@kernl/core` |
| `packages/guard` | `@kernlize/guard` | `@kernl/guard` |
| `packages/messaging` | `@kernlize/messaging` | `@kernl/messaging` |

Workspace manifests, source imports, examples and Changesets use the npm names. JSR's publisher rewrites imports using a generated import map; a JSR install of core depends on the other three JSR packages. The app and docs are private workspaces.

## Configure the registries once

1. On npm, ensure the release maintainer can publish public packages in the `kernlize` organization. Configure a trusted publisher for each package: GitHub owner `kernlize`, repository `web`, workflow filename `release.yml`, no environment. Allow direct `npm publish`. The workflow uses Node 24 and npm 11, meeting [npm's trusted publishing requirements](https://docs.npmjs.com/trusted-publishers/). Before trusted publishing is configured, including the first release if the package does not exist yet, set the repository's `NPM_TOKEN` secret to a granular token with publish access to these packages and the required 2FA bypass. Remove the token when OIDC is working.
2. On JSR, create the four packages in the `kernl` scope and link each package to GitHub repository `kernlize/web`. Follow [JSR's CI publishing setup](https://jsr.io/docs/publishing-packages). `release.yml` grants `id-token: write`; JSR uses GitHub OIDC without a registry token. The scope and packages must exist before the first automated release.
3. In GitHub Actions settings, allow workflows to create pull requests. `publish.yml` needs that setting to open the Version Packages PR using `GITHUB_TOKEN`.

Registry ownership and trusted publisher settings live on the registries. A local dry-run cannot verify those permissions.

## Prepare a release

Add a changeset with `pnpm changeset` for each changed package, using its `@kernlize/*` name. On 0.x, breaking changes get a minor bump. Merge the changes; `publish.yml` opens or updates the Version Packages PR. Its version command updates manifests, changelogs, the lockfile and documentation version rows together. Merge that PR before releasing.

From a clean checkout of the release commit, with Node 24, pnpm 10.24.0 and Deno 2.9.8:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm check:packages
pnpm check:jsr
```

`check:packages` packs the actual npm artifacts, checks their files and dependency names, then installs, imports and type-checks all four in a temporary consumer outside the workspace. Installation scripts are disabled for that consumer.

`prepare:jsr` rebuilds the ignored `.jsr/` workspace from the manifests. It copies TypeScript sources, README and license, excludes tests, resolves relative imports to `.ts`, maps internal packages to `jsr:@kernl/*` at their current versions, and pins external npm dependencies (including peers) to the versions installed from `pnpm-lock.yaml`. JSR has no peer dependency mechanism; this keeps its release on the versions checked in the workspace. `check:jsr` runs Deno's publish dry-run, including type checks and fast-type validation. No generated JSR version needs a separate bump.

## Publish and retry

Run the **Release** workflow on the versioned `main` commit, or push a `v*` tag at that commit. The Version Packages workflow does not publish by itself:

```sh
gh workflow run release.yml --ref main
```

The release first runs all gates and both artifact checks. Independent npm and JSR jobs publish only after validation passes. npm uses Changesets and pnpm packing, so `workspace:^` dependencies become ordinary npm ranges. JSR publishes the generated workspace in dependency order. Concurrent release runs are serialized.

Both publishers skip versions already present, so rerun the workflow at the same commit if one registry failed after the other succeeded. Inspect both jobs before announcing a release. If an artifact itself was wrong, fix the source and create a new changeset; published versions are immutable. Reverting this migration before publishing is a normal Git revert; after publication, retain the registry names for existing consumers.
