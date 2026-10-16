#!/usr/bin/env nix-shell
#!nix-shell -i bash -p nodejs_24 chromium
# Render scenes at desktop and the Fold 8 postures into shots/ (ignored by git).
# Usage: ./render.sh [light|dark] [scene ...]
set -euo pipefail
cd "$(dirname "$0")"
CHROME_BIN="$(command -v chromium)" node shoot.mjs "$@"
