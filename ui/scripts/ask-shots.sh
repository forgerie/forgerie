#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium nixpkgs#bash --command bash
# Capture the ask-form fixture scenarios at the four Fold postures in both themes.
# The fixture is network-free. Requires the dev server on 8510.
set -euo pipefail
root="${FORGERIE_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
out="$(cd "$(dirname "$0")/.." && pwd)/verification/local/ask-shots"
app="${APP_URL:-http://127.0.0.1:8510/}"
export CHROME_BIN="${CHROME_BIN:-$(command -v chromium)}"
mkdir -p "$out"
for scenario in ${SCENARIOS:-ask ask-long ask-reconnecting}; do
  for scheme in light dark; do
    node "$root/scripts/capture-postures.mjs" --url "${app}verification/preview.html?scenario=$scenario" \
      --out "$out" --label "$scenario-$scheme" --color-scheme "$scheme"
  done
done
ls "$out"
