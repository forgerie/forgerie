#!/usr/bin/env bash
# Measures lane alignment on a prototype page, resolving Chromium the way
# render.sh does. findChrome probes through a login shell, which does not
# inherit a `nix shell` PATH, so the binary is resolved here.
#
#   ./prototypes/quota-shelf/measure.sh round34
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

chrome="$(command -v chromium || true)"
if [[ -z "$chrome" ]]; then
  chrome="$(nix build --no-link --print-out-paths nixpkgs#chromium)/bin/chromium"
fi

CHROME_BIN="$chrome" \
  nix shell nixpkgs#nodejs_22 --command node "$here/measure.mjs" "$@"
