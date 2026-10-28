#!/usr/bin/env nix-shell
#!nix-shell -i bash -p nodejs_24 chromium
# Render the input bar's overflow ladder: scenes at a row of widths, all 568 px tall.
# Usage: ./render-ladder.sh [dark|light] [scene ...]
set -euo pipefail
cd "$(dirname "$0")"
scheme="${1:-light}"; shift || true
scenes=("$@")
if [ ${#scenes[@]} -eq 0 ]; then scenes=(both-min one-min bar-menu); fi
export CHROME_BIN="$(command -v chromium)"
for width in 704 475 400 360 320 280; do
  node shoot-size.mjs --width "${width}" --height 568 --scheme "${scheme}" --label "w${width}" "${scenes[@]}"
done
