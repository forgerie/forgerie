#!/usr/bin/env nix-shell
#! nix-shell -i bash -p nodejs_24 chromium
set -euo pipefail
export CHROME_BIN="$(command -v chromium)"
root="${FORGERIE_ROOT:-$(git rev-parse --path-format=absolute --git-common-dir)/..}"
url="${ATTACHMENT_URL:-http://127.0.0.1:8514}"
for scheme in light dark; do
  for scenario in attachments attachments-ask attachments-error; do
    node "$root/scripts/capture-postures.mjs" \
      --url "$url/verification/preview.html?scenario=$scenario" \
      --out verification/local/attachments \
      --label "$scenario-$scheme" --color-scheme "$scheme"
  done
done
