#!/bin/sh
# A minimal systemd PATH must still find Nix before re-executing with the full tool set.
PATH="${PATH:-/usr/bin:/bin}:/run/current-system/sw/bin:/etc/profiles/per-user/${USER:-}/bin:${HOME:?}/.nix-profile/bin"
export PATH
if [ -z "${FORGERIE_DEPLOY_SHELL:-}" ]; then
  FORGERIE_DEPLOY_SHELL=1 exec nix --extra-experimental-features 'nix-command flakes' shell \
    nixpkgs#bash nixpkgs#curl nixpkgs#jq nixpkgs#coreutils nixpkgs#systemd nixpkgs#git nixpkgs#nodejs_24 --command bash "$0" "$@"
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
main() {
  # Publication has one implementation, shipped in the verified build's CLI.
  if [ "${1:-}" = "--now" ]; then
    [ "$#" -eq 4 ] || { echo "usage: redeploy-when-idle.sh --now BUILT_DIST DEPLOYED_DIST EXPECTED_SHA" >&2; exit 1; }
    exec node "$2/cli.js" deploy "$2" "$3" "$4"
  fi
  if [ -n "${3:-}${4:-}" ]; then
    [ "$#" -eq 4 ] && [ -n "${FORGERIE_REDEPLOY_REVISION:-}" ] || { echo "Publication requires both dist paths and FORGERIE_REDEPLOY_REVISION (full expected SHA)" >&2; exit 1; }
    exec node "$3/cli.js" deploy "$3" "$4" "$FORGERIE_REDEPLOY_REVISION" --when-idle "$1" --limit-minutes "$2"
  fi
  for tool in bash curl jq date sleep systemctl tee git node; do command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }; done
  if [ "${1:-}" = "--check" ]; then echo "Redeploy dependencies ready"; return; fi
  own="${1:?usage: redeploy-when-idle.sh WORKSPACE [LIMIT_MINUTES] [BUILT_DIST DEPLOYED_DIST]}"
  local limit="${2:-60}"
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
  systemctl --user restart forgerie-sessiond.service forgerie-web.service
  # Verify the units and HTTP, not merely the restart command's exit status.
  deadline=$(( $(date +%s) + 60 ))
  until systemctl --user is-active --quiet forgerie-sessiond.service forgerie-web.service && curl -fsS --max-time 5 "$url/build.json" >/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then say "failed: services or HTTP did not become ready"; return 1; fi
    sleep 2
  done
  say "done; build $(curl -fsS --max-time 5 "$url/build.json")"
}
main "$@"
