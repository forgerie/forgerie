#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium nodejs_22
# Render every variant at the two bracket postures via CDP emulation.
# See capture.mjs for why this does not use --window-size.
set -euo pipefail
cd "$(dirname "$0")"
CHROME_BIN="$(command -v chromium)" node capture.mjs
