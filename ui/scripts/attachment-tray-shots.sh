#!/usr/bin/env nix-shell
#! nix-shell -i bash -p nodejs_24 chromium
# The new-session attachment tray in every Fold 8 posture and both schemes.
#   scripts/attachment-tray-shots.sh <label> [scenario...]
set -euo pipefail
export CHROME_BIN="$(command -v chromium)"
root="${FORGERIE_ROOT:-$(git rev-parse --path-format=absolute --git-common-dir)/..}"
url="${ATTACHMENT_URL:-http://127.0.0.1:8521}"
label="${1:?label}"; shift
scenarios=("${@:-new-session-attach-folder new-session-attach-inline new-session-attach-many}")
for scheme in dark light; do
  for scenario in ${scenarios[@]}; do
    node "$root/scripts/capture-postures.mjs" \
      --url "$url/verification/preview.html?scenario=$scenario" \
      --out verification/local/attachment-tray \
      --label "$label-$scenario-$scheme" --color-scheme "$scheme" --settle 1800
  done
done
