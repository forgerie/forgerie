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
# Capture a self-contained, still-verifiable source before the original worktree can disappear.
# Publication itself remains exclusively in the verified build's CLI.
launch_build() {
  local prepared deployed revision own="" limit=""
  if [ "${1:-}" = "--now" ]; then
    [ "$#" -eq 4 ] || { echo "usage: --launch --now BUILT_DIST DEPLOYED_DIST EXPECTED_REVISION" >&2; return 1; }
    prepared="$2"; deployed="$3"; revision="$4"
  else
    [ "$#" -eq 4 ] && [ -n "${FORGERIE_REDEPLOY_REVISION:-}" ] || { echo "Idle launch requires WORKSPACE LIMIT_MINUTES BUILT_DIST DEPLOYED_DIST and FORGERIE_REDEPLOY_REVISION" >&2; return 1; }
    own="$1"; limit="$2"; prepared="$3"; deployed="$4"; revision="$FORGERIE_REDEPLOY_REVISION"
    [[ "$own" = /* && "$limit" =~ ^[0-9]+$ ]] || { echo "Invalid idle workspace or limit" >&2; return 1; }
  fi
  [[ "$prepared" = /* && "$deployed" = /* && "$prepared" != / && "$deployed" != / && -n "$revision" ]] || { echo "Launch requires absolute build paths and an explicit expected revision" >&2; return 1; }
  local source_root target_root
  source_root=$(realpath "$(dirname "$prepared")"); target_root=$(realpath "$(dirname "$deployed")")
  prepared="$source_root/$(basename "$prepared")"; deployed="$target_root/$(basename "$deployed")"
  [[ -d "$prepared" && ! -L "$prepared" && -d "$deployed" && ! -L "$deployed" && "$source_root" != "$target_root" ]] || { echo "Build paths must be isolated real directories" >&2; return 1; }
  case "$prepared/" in "$deployed/"*) echo "Build paths must not overlap" >&2; return 1;; esac
  case "$deployed/" in "$prepared/"*) echo "Build paths must not overlap" >&2; return 1;; esac
  revision=$(git -C "$source_root" rev-parse --verify --end-of-options "$revision^{commit}")
  [[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo "Expected a full 40-character commit SHA" >&2; return 1; }
  check_launch_source() {
    [ "$(git -C "$source_root" rev-parse --show-toplevel)" = "$source_root" ] &&
      [ "$(git -C "$source_root" rev-parse HEAD)" = "$revision" ] &&
      [ -z "$(git -C "$source_root" status --porcelain --untracked-files=all)" ] || { echo "Verified source checkout must be clean at the expected SHA" >&2; return 1; }
  }
  check_launch_source
  [ "$(git -C "$target_root" rev-parse --show-toplevel)" = "$target_root" ] &&
    [ "$(git -C "$target_root" rev-parse HEAD)" = "$revision" ] || { echo "Deployed checkout revision differs from expected SHA" >&2; return 1; }
  [ -d "$source_root/node_modules" ] || { echo "Missing source dependencies; run npm ci before recording and launching the build" >&2; return 1; }
  local stage unit staged_build status=0
  mkdir -p "$target_root/.forgerie"
  [ "$(realpath "$target_root/.forgerie")" = "$target_root/.forgerie" ] || { echo "Deployment state directory must not be a symlink" >&2; return 1; }
  stage=$(mktemp -d "$target_root/.forgerie/publish.XXXXXX"); unit="fg-publish-${stage##*/}"
  git clone --quiet --no-hardlinks --dissociate --no-checkout "$source_root" "$stage/source"
  git -C "$stage/source" checkout --quiet --detach "$revision"
  staged_build="$stage/source/$(basename "$prepared")"
  cp -aT "$prepared" "$staged_build"
  # Dereference dependency links too: neither the worktree nor a linked install must remain live.
  cp -aLT "$source_root/node_modules" "$stage/source/node_modules"
  cp "$0" "$stage/launcher.sh"
  check_launch_source
  jq -n --arg revision "$revision" --arg unit "$unit" '{status:"queued",revision:$revision,unit:$unit}' > "$stage/result.json"
  local -a flags=()
  if [ -n "$own" ]; then flags=(--when-idle "$own" --limit-minutes "$limit"); fi
  systemd-run --user --quiet --collect --unit="$unit" --property=Type=exec --property=KillMode=control-group \
    --property="WorkingDirectory=$stage" --property="StandardOutput=append:$stage/publish.log" --property=StandardError=inherit \
    --setenv="PATH=$PATH" --setenv="HOME=$HOME" --setenv=FORGERIE_DEPLOY_SHELL=1 --setenv="FORGERIE_PUBLISH_UNIT=$unit" \
    --setenv="FORGERIE_REDEPLOY_URL=${FORGERIE_REDEPLOY_URL:-http://127.0.0.1:8504}" \
    -- "$(command -v bash)" "$stage/launcher.sh" --run-staged "$stage/result.json" "$staged_build" "$deployed" "$revision" "${flags[@]}" || status=$?
  if [ "$status" -ne 0 ]; then
    jq -n --arg revision "$revision" --arg unit "$unit" --argjson exitCode "$status" '{status:"failed",phase:"launch",exitCode:$exitCode,revision:$revision,unit:$unit}' > "$stage/result.json"
    echo "Launch failed; retained $stage" >&2; return "$status"
  fi
  echo "Queued $unit; retained build, publish.log and result.json: $stage"
}
write_publish_result() {
  local status=$?
  trap - EXIT
  jq -n --arg status "$([ "$status" -eq 0 ] && echo passed || echo failed)" --argjson exitCode "$status" \
    --arg revision "$publish_revision" --arg unit "${FORGERIE_PUBLISH_UNIT:-}" \
    '{status:$status,exitCode:$exitCode,revision:$revision,unit:$unit}' > "$publish_result.tmp"
  mv "$publish_result.tmp" "$publish_result"
  exit "$status"
}
run_staged() {
  publish_result="${1:?missing result path}"; publish_revision="${4:?missing revision}"
  local prepared="$2" deployed="$3"
  shift 4
  trap write_publish_result EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT
  trap 'exit 129' HUP
  node "$prepared/cli.js" deploy "$prepared" "$deployed" "$publish_revision" "$@"
}
main() {
  if [ "${1:-}" = "--launch" ]; then shift; launch_build "$@"; return; fi
  if [ "${1:-}" = "--run-staged" ]; then shift; run_staged "$@"; return; fi
  # Publication has one implementation, shipped in the verified build's CLI.
  if [ "${1:-}" = "--now" ]; then
    [ "$#" -eq 4 ] || { echo "usage: redeploy-when-idle.sh --now BUILT_DIST DEPLOYED_DIST EXPECTED_SHA" >&2; exit 1; }
    exec node "$2/cli.js" deploy "$2" "$3" "$4"
  fi
  if [ -n "${3:-}${4:-}" ]; then
    [ "$#" -eq 4 ] && [ -n "${FORGERIE_REDEPLOY_REVISION:-}" ] || { echo "Publication requires both dist paths and FORGERIE_REDEPLOY_REVISION (full expected SHA)" >&2; exit 1; }
    exec node "$3/cli.js" deploy "$3" "$4" "$FORGERIE_REDEPLOY_REVISION" --when-idle "$1" --limit-minutes "$2"
  fi
  for tool in bash curl jq date sleep systemctl systemd-run tee git node cp mv realpath mktemp dirname basename; do command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }; done
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
  until systemctl --user is-active --quiet forgerie-sessiond.service &&
    systemctl --user is-active --quiet forgerie-web.service &&
    curl -fsS --max-time 5 "$url/build.json" >/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then say "failed: services or HTTP did not become ready"; return 1; fi
    sleep 2
  done
  say "done; build $(curl -fsS --max-time 5 "$url/build.json")"
}
main "$@"
