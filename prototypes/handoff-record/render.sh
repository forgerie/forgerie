#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium nodejs_22
# Render every variant at three postures via CDP emulation.
# See capture.mjs for why this does not use --window-size.
#   ./render.sh            round 1 (index.html)
#   ./render.sh stateless  round 2 (stateless.html)
set -euo pipefail
cd "$(dirname "$0")"
CHROME_BIN="$(command -v chromium)" node capture.mjs "${1:-index}"
