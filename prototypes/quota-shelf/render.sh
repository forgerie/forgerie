#!/usr/bin/env bash
# Renders the prototype pages with a Chromium that `findChrome` cannot see.
#
# findChrome probes through a login shell, which does not inherit a `nix shell`
# PATH, so the binary has to be resolved here and handed over as CHROME_BIN.
#
#   PAGES="round15" ./prototypes/quota-shelf/render.sh /tmp/quota-shelf-shots
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-/tmp/quota-shelf-shots}"

chrome="$(command -v chromium || true)"
if [[ -z "$chrome" ]]; then
  chrome="$(nix build --no-link --print-out-paths nixpkgs#chromium)/bin/chromium"
fi

CHROME_BIN="$chrome" PAGES="${PAGES:-round15}" \
  nix shell nixpkgs#nodejs_22 --command node "$here/render.mjs" "$out"
