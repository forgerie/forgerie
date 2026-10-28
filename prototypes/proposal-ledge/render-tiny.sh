#!/usr/bin/env nix-shell
#!nix-shell -i bash -p nodejs_24 chromium
# Render scenes at a 320 x 568 phone, the smallest size the ledge must hold.
# Usage: ./render-tiny.sh [dark|light] [scene ...]
set -euo pipefail
cd "$(dirname "$0")"
scheme="${1:-light}"; shift || true
scenes=("$@")
if [ ${#scenes[@]} -eq 0 ]; then scenes=(one many both many-open states menu one-min both-min); fi
export CHROME_BIN="$(command -v chromium)"
node shoot-size.mjs --width 320 --height 568 --scheme "${scheme}" --label tiny "${scenes[@]}"
