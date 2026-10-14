#!/bin/sh
# A minimal systemd PATH must still find Nix before re-executing with the full tool set.
PATH="${PATH:-/usr/bin:/bin}:/run/current-system/sw/bin:/etc/profiles/per-user/${USER:-}/bin:${HOME:?}/.nix-profile/bin"
export PATH
if [ -z "${FORGERIE_DEPLOY_SHELL:-}" ]; then
  FORGERIE_DEPLOY_SHELL=1 exec nix --extra-experimental-features 'nix-command flakes' shell \
    nixpkgs#bash nixpkgs#curl nixpkgs#jq nixpkgs#coreutils nixpkgs#systemd nixpkgs#git --command bash "$0" "$@"
fi
unset FORGERIE_DEPLOY_SHELL
# The body runs in Bash. A failed curl must never look like an idle server.
set -euo pipefail

say() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$log"; }
idle() {
  curl -fsS --max-time 10 "$url/api/machines/local/activity" | jq -e --arg own "$own" '
    if (.workspaces | type) != "array" then error("Missing workspace activity")
    elif any(.workspaces[]; (.hasSessionActivity | type) != "boolean" or (.cwd | type) != "string") then error("Invalid workspace activity")
    else all(.workspaces[]; .hasSessionActivity == false or .cwd == $own) end' >/dev/null
}
publish_build() {
  local stage
  mkdir -p "$(dirname "$deployed")/.forgerie"
  stage=$(mktemp -d "$(dirname "$deployed")/.forgerie/deploy.XXXXXX")
  cp -a "$prepared" "$stage/next"
  if [ -n "${FORGERIE_REDEPLOY_REVISION:-}" ] && [ "$(git -C "$(dirname "$deployed")" rev-parse HEAD)" != "$FORGERIE_REDEPLOY_REVISION" ]; then
    say "refused: deployed checkout changed while waiting. Build its new revision before restarting."
    return 1
  fi
  # Copy before stopping. Swap only while both units are down, so the new UI never calls an old server.
  systemctl --user stop forgerie-sessiond.service forgerie-web.service
  if [ -e "$deployed" ]; then
    mv "$deployed" "$stage/previous" || { systemctl --user start forgerie-sessiond.service forgerie-web.service; return 1; }
  fi
  if ! mv "$stage/next" "$deployed"; then
    if [ -e "$stage/previous" ]; then mv "$stage/previous" "$deployed"; fi
    systemctl --user start forgerie-sessiond.service forgerie-web.service
    return 1
  fi
  say "published $prepared; previous build kept at $stage/previous"
  systemctl --user start forgerie-sessiond.service forgerie-web.service
}
main() {
  for tool in bash curl jq date sleep systemctl tee git; do command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }; done
  if [ "${1:-}" = "--check" ]; then echo "Redeploy dependencies ready"; return; fi
  own="${1:?usage: redeploy-when-idle.sh WORKSPACE [LIMIT_MINUTES] [BUILT_DIST DEPLOYED_DIST]}"
  local limit="${2:-60}"
  prepared="${3:-}"; deployed="${4:-}"
  if [ -n "$prepared$deployed" ]; then
    [[ "$prepared" = /* && "$deployed" = /* && "$deployed" != / && "$prepared" != "$deployed" ]] || { echo "Build paths must be different absolute paths" >&2; exit 1; }
    [ -f "$prepared/server/sessiond.js" ] && [ -f "$prepared/server/index.js" ] && [ -f "$prepared/client/build.json" ] || { echo "Prepared build is incomplete" >&2; exit 1; }
    if [ -e "$deployed" ] && { [ ! -f "$deployed/server/sessiond.js" ] || [ ! -f "$deployed/client/build.json" ]; }; then
      echo "Destination is not a Forgerie build" >&2; exit 1
    fi
  fi
  [[ "$limit" =~ ^[0-9]+$ ]] || { echo "LIMIT_MINUTES must be a non-negative integer" >&2; exit 1; }
  url="${FORGERIE_REDEPLOY_URL:-http://127.0.0.1:8504}"
  log="${FORGERIE_REDEPLOY_LOG:-$HOME/.local/share/forgerie/redeploy-when-idle.log}"
  mkdir -p "$(dirname "$log")"
  say "start: waiting for other sessions to go idle (ignoring $own, limit ${limit}m)"
  local deadline=$(( $(date +%s) + limit * 60 ))
  while ! idle; do
    if [ "$(date +%s)" -ge "$deadline" ]; then say "gave up: busy or activity unavailable. Nothing restarted."; return 1; fi
    sleep 30
  done
  say "idle; restarting forgerie-sessiond and forgerie-web"
  if [ -n "$prepared" ]; then publish_build; else systemctl --user restart forgerie-sessiond.service forgerie-web.service; fi
  # Verify the units and HTTP, not merely the restart command's exit status.
  deadline=$(( $(date +%s) + 60 ))
  until systemctl --user is-active --quiet forgerie-sessiond.service forgerie-web.service && curl -fsS --max-time 5 "$url/build.json" >/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then say "failed: services or HTTP did not become ready"; return 1; fi
    sleep 2
  done
  say "done; build $(curl -fsS --max-time 5 "$url/build.json")"
}
main "$@"
