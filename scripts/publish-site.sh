#!/usr/bin/env bash
# Build, audit and deploy the .pages/ artifact to the bunny.net site behind
# https://kernl.run/ (DECISIONS D-019). The Publish site workflow does the same on
# every push to main; this is the manual path. Needs `bunny login` or BUNNYNET_API_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."
export SITE_URL="${SITE_URL:-https://kernl.run/}"
export SITE_BASE="${SITE_BASE:-/}"
export VITEPRESS_BASE="${SITE_BASE}docs/"
pnpm site:build
pnpm check:vocabulary
pnpm check:agent-ready
bunny sites deploy .pages --site "${BUNNY_SITE:-kernl}" --no-link
