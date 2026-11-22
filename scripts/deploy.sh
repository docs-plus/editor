#!/usr/bin/env bash
# Deploys one commit of main to this host (production: tiny.docs.plus).
#
# The GitHub "Deploy" workflow (.github/workflows/deploy.yml) runs it over
# SSH as a forced command, so its key can do nothing else:
#
#   restrict,command="/opt/projects/editor.docs.plus/scripts/deploy.sh" ssh-ed25519 AAAA… tinydocy-deploy
#
# The client's command (SSH_ORIGINAL_COMMAND) is the full 40-character SHA
# to deploy; it can also be passed as the first argument when run by hand.
# Steps (docs/operations/deploy-runbook.md):
#   1. fast-forward the live checkout to the commit and install;
#   2. build Next.js in a second checkout (the live site keeps serving);
#   3. restart Hocus (it runs from source), then swap the build in and
#      restart Next.js, keeping the previous build in .next.prev;
#   4. check both answer, and put the previous build back if Next.js does not;
#   5. register the daily retention purge (editor-purge) with PM2 without
#      purging: the run PM2 starts exits at once, so only the cron purges.
# It only moves forward along main, and only to a commit whose .tool-versions
# pins the Bun this host runs. Roll back with the runbook.
# The body is one function, so bash has read all of it before the
# fast-forward replaces this file. Changes to it apply from the next deploy.
set -euo pipefail

main() {

sha="${SSH_ORIGINAL_COMMAND:-${1:-}}"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "deploy: expected a full 40-character commit SHA" >&2
  exit 2
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$(dirname "$APP_DIR")/editor-build"
NEXT_PORT="${DEPLOY_NEXT_PORT:-3847}"
HOCUS_PORT="${DEPLOY_HOCUS_PORT:-3848}"
export PATH="$HOME/.bun/bin:$PATH"
pm2() { bunx pm2@6.0.14 "$@"; }
log() { printf '\n== %s\n' "$*"; }

# A forced-command session is not a login shell: fail before touching
# anything if a tool is missing from its PATH.
local tool
for tool in bun bunx git flock curl mktemp; do
  if ! command -v "$tool" > /dev/null; then
    echo "deploy: $tool is not on PATH ($PATH)" >&2
    exit 9
  fi
done

# One deploy at a time.
exec 9>"/tmp/tinydocy-deploy.lock"
if ! flock -n 9; then
  echo "deploy: another deploy is running" >&2
  exit 3
fi

cd "$APP_DIR"

log "Checking $sha"
git fetch --quiet origin main
if ! git merge-base --is-ancestor "$sha" origin/main; then
  echo "deploy: $sha is not on origin/main" >&2
  exit 4
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "deploy: the live checkout has local changes; resolve them first" >&2
  git status --short --untracked-files=no >&2
  exit 5
fi
if ! git merge-base --is-ancestor HEAD "$sha"; then
  echo "deploy: $sha is behind the deployed $(git rev-parse --short HEAD); roll back with the runbook" >&2
  exit 6
fi
# Build and run the commit only on the Bun its .tool-versions pins (the file
# the build checkout gets). A host still on another Bun stops here, before
# the build and the Hocus restart: upgrade Bun first (deploy runbook).
local want have
want="$(git show "$sha:.tool-versions" 2>/dev/null | awk '$1 == "bun" { print $2 }')" || want=""
have="$(bun --version)"
if [ -z "$want" ] || [ "$want" != "$have" ]; then
  echo "deploy: $sha needs Bun ${want:-(no bun line in .tool-versions)}; this host has $have. Upgrade Bun first (docs/operations/deploy-runbook.md)" >&2
  exit 11
fi

log "Building $(git log -1 --format='%h %s' "$sha") in $BUILD_DIR"
if [ -e "$BUILD_DIR" ]; then
  git worktree remove --force "$BUILD_DIR" 2>/dev/null || rm -rf "$BUILD_DIR"
fi
git worktree prune
git worktree add --detach "$BUILD_DIR" "$sha"
# Package scripts that run during install (husky's prepare, sharp's) start
# with `#!/usr/bin/env node`, and Bun runs them on the host's own node: an old
# Node 14 that other services on this host use, which cannot parse them. Give
# the installs a node that is Bun. HUSKY=0: a server checkout needs no hooks.
node_shim="$(mktemp -d)"
ln -s "$(command -v bun)" "$node_shim/node"
install_deps() { HUSKY=0 PATH="$node_shim:$PATH" bun install --frozen-lockfile; }
cleanup() {
  git -C "$APP_DIR" worktree remove --force "$BUILD_DIR" 2>/dev/null || true
  rm -rf "$node_shim"
}
trap cleanup EXIT
(cd "$BUILD_DIR" && install_deps)
cp .env.production "$BUILD_DIR/"
(cd "$BUILD_DIR" && bun run build)

log "Updating the live checkout"
git merge --ff-only --quiet "$sha"
install_deps

wait_for() { # url-or-port, seconds
  local target="$1" seconds="$2"
  for ((i = 0; i < seconds; i++)); do
    if [[ "$target" == http* ]]; then
      curl -fsS -o /dev/null --max-time 5 "$target" && return 0
    else
      (exec 3<>"/dev/tcp/127.0.0.1/$target") 2>/dev/null && return 0
    fi
    sleep 1
  done
  return 1
}

log "Restarting Hocus"
pm2 restart ecosystem.config.cjs --only editor-hocus --update-env
if ! wait_for "$HOCUS_PORT" 60; then
  echo "deploy: Hocus is not listening on $HOCUS_PORT; Next.js was left on the previous build" >&2
  exit 7
fi

log "Swapping the Next.js build"
rm -rf .next.prev
mv .next .next.prev
mv "$BUILD_DIR/.next" .next
pm2 restart ecosystem.config.cjs --only editor-next --update-env
if ! wait_for "http://127.0.0.1:$NEXT_PORT/" 90; then
  echo "deploy: Next.js did not answer on $NEXT_PORT; putting the previous build back" >&2
  rm -rf .next
  mv .next.prev .next
  pm2 restart ecosystem.config.cjs --only editor-next --update-env
  exit 8
fi

# After the site is live: a failure here leaves the new build serving.
# PM2 cannot add or update an app without running it, so the marker tells
# that run to exit without purging (scripts/purge-retention.ts). It sits next
# to the database (DB_PATH is db.sqlite in this directory).
log "Registering the retention purge (no run)"
purge_marker="$APP_DIR/.purge-skip-next"
date +%s > "$purge_marker"
if ! pm2 startOrRestart ecosystem.config.cjs --only editor-purge --update-env; then
  rm -f "$purge_marker"
  echo "deploy: the site is deployed, but editor-purge was not registered" >&2
  exit 10
fi

log "Deployed $(git log -1 --format='%h %s')"
pm2 logs editor-hocus --lines 5 --nostream || true
}

main "$@"
