#!/usr/bin/env bash
#
# setup-bunny-secrets.sh: configure GitHub for the "Publish site" workflow
# (.github/workflows/pages.yml), which deploys .pages/ to the bunny.net site
# that serves https://kernl.run/ (DECISIONS D-019).
#
# Sets, via the GitHub CLI:
#   Secret    BUNNYNET_API_KEY  bunny.net account API key, read from $BUNNYNET_API_KEY
#                               or the bunny CLI profile (bunny login). Never echoed.
#   Variable  BUNNY_SITE        bunny site name (default kernl)
#   Variable  SITE_URL          absolute site root (default https://kernl.run/)
#   Variable  SITE_BASE         path the site is served under (default /)
#
# Idempotent: values come from the environment and the bunny CLI, never from
# prompts, so every run converges on the same state. Variables are written only
# when they differ; the secret is rewritten with the same value because GitHub
# never reveals a stored secret to compare against.
#
# Usage:
#   scripts/setup-bunny-secrets.sh [owner/repo]
#   BUNNY_SITE=kernl SITE_URL=https://kernl.run/ BUNNY_PROFILE=default scripts/setup-bunny-secrets.sh
set -euo pipefail

BUNNY_SITE="${BUNNY_SITE:-kernl}"
SITE_URL="${SITE_URL:-https://kernl.run/}"
SITE_BASE="${SITE_BASE:-/}"
BUNNY_PROFILE="${BUNNY_PROFILE:-default}"

ok() { printf '\033[32m✓\033[0m %s\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }
err() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; }
die() { err "$1"; exit 1; }

command -v gh >/dev/null 2>&1 || die "GitHub CLI (gh) is not installed: https://cli.github.com/"
command -v bunny >/dev/null 2>&1 || die "bunny CLI is not installed: https://bunny.net/docs/cli"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run: gh auth login"

REPO="${1:-}"
if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" \
    || die "Not inside a GitHub repository and no owner/repo given. Usage: $0 [owner/repo]"
fi

# The key is read once and only ever passed through stdin or the environment.
api_key="${BUNNYNET_API_KEY:-}"
if [[ -z "$api_key" ]]; then
  for config in "${XDG_CONFIG_HOME:-}/bunnynet.json" "$HOME/.config/bunnynet.json" "$HOME/.bunnynet.json" /etc/bunnynet.json; do
    [[ -f "$config" ]] || continue
    api_key="$(node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(c.profiles?.[process.argv[2]]?.api_key ?? "")' "$config" "$BUNNY_PROFILE")"
    break
  done
fi
[[ -n "$api_key" ]] || die "No bunny.net API key. Run: bunny login   (or export BUNNYNET_API_KEY)"
export BUNNYNET_API_KEY="$api_key"

bunny api GET /user >/dev/null 2>&1 || die "The bunny.net API key was rejected. Run: bunny login"
bunny sites show "$BUNNY_SITE" >/dev/null 2>&1 \
  || die "bunny site \"$BUNNY_SITE\" does not exist. Create it once: bunny sites create $BUNNY_SITE --no-link --domain ${SITE_URL#https://}"

echo "Configuring $REPO for bunny site \"$BUNNY_SITE\""

printf '%s' "$api_key" | gh secret set BUNNYNET_API_KEY --repo "$REPO" >/dev/null
ok "secret BUNNYNET_API_KEY"

set_var() {
  local name="$1" value="$2" current
  current="$(gh variable get "$name" --repo "$REPO" 2>/dev/null || true)"
  if [[ "$current" == "$value" ]]; then
    ok "variable $name = $value (unchanged)"
    return
  fi
  gh variable set "$name" --repo "$REPO" --body "$value" >/dev/null
  ok "variable $name = $value"
}

set_var BUNNY_SITE "$BUNNY_SITE"
set_var SITE_URL "$SITE_URL"
set_var SITE_BASE "$SITE_BASE"

dim "Deploy now: gh workflow run 'Publish site' --repo $REPO"
