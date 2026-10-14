#!/usr/bin/env nix-shell
#!nix-shell -i bash -p nodejs_24 chromium
# Render every scene at the four Fold 8 postures, in one colour scheme.
# Usage: ./render.sh [dark|light] [scene ...]
set -euo pipefail
cd "$(dirname "$0")"
scheme="${1:-dark}"; shift || true
scenes=("$@")
if [ ${#scenes[@]} -eq 0 ]; then
  scenes=(working working-open working-details idle-background-open stuck-open)
fi
export CHROME_BIN="$(command -v chromium)"
mkdir -p shots
for scene in "${scenes[@]}"; do
  node ../../scripts/capture-postures.mjs --url "file://$(pwd)/index.html?scene=${scene}" \
    --out shots --label "${scheme}-${scene}" --color-scheme "${scheme}" --settle 1200
done
