#!/usr/bin/env nix-shell
#!nix-shell -i bash -p nodejs_24 chromium
set -euo pipefail
export CHROME_BIN="$(command -v chromium)"
root="${FORGERIE_ROOT:-$(realpath ../..)}"
base="${APP_URL:-http://127.0.0.1:8510/}"
for scheme in light dark; do
  for scenario in history streamdown-running; do
    node "$root/scripts/capture-postures.mjs" \
      --url "${base%/}/verification/preview.html?scenario=$scenario" \
      --out verification/local/streamdown/shots --label "$scenario-$scheme" \
      --color-scheme "$scheme"
  done
done
