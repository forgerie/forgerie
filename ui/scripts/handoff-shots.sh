#!/usr/bin/env nix-shell
#! nix-shell -i bash -p nodejs_24 chromium
# Captures handoff and spawn doors, closed and expanded, in every Fold posture and theme.
set -euo pipefail
export CHROME_BIN="$(command -v chromium)"
root="${FORGERIE_ROOT:-$(git rev-parse --path-format=absolute --git-common-dir)/..}"
url="${HANDOFF_URL:-http://127.0.0.1:8517}"
for scheme in light dark; do
  for scenario in handoff handoff-open; do
    node "$root/scripts/capture-postures.mjs" \
      --url "$url/verification/preview.html?scenario=$scenario" \
      --out verification/local/handoff \
      --label "$scenario-$scheme" --color-scheme "$scheme"
  done
done
