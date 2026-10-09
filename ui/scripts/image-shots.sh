#!/usr/bin/env nix-shell
#! nix-shell -i bash -p nodejs_24 chromium
# Captures the reply gallery and the open viewer in every Fold posture and theme.
set -euo pipefail
export CHROME_BIN="$(command -v chromium)"
root="${FORGERIE_ROOT:-$(git rev-parse --path-format=absolute --git-common-dir)/..}"
url="${IMAGES_URL:-http://127.0.0.1:8516}"
for scheme in light dark; do
  for scenario in images images-viewer; do
    node "$root/scripts/capture-postures.mjs" \
      --url "$url/verification/preview.html?scenario=$scenario" \
      --out verification/local/images \
      --label "$scenario-$scheme" --color-scheme "$scheme"
  done
done
