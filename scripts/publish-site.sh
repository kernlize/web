#!/usr/bin/env bash
# Publish the built .pages/ artifact to https://kernlize.github.io/ (DECISIONS D-013).
# Manual by choice: the public repo kernlize/kernlize.github.io holds only built output.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm site:build
pnpm check:vocabulary
pnpm check:agent-ready
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone --quiet --depth 1 git@github.com:kernlize/kernlize.github.io.git "$work/site"
find "$work/site" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R .pages/. "$work/site/"
cd "$work/site"
git add -A
if git diff --cached --quiet; then
  echo "site unchanged"
  exit 0
fi
git commit --quiet -m "Publish kernl site from $(git -C "$OLDPWD" rev-parse --short HEAD)"
git push --quiet origin HEAD:main
echo "published https://kernlize.github.io/"
