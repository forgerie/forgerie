#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium
# Render the whole board, then each candidate alone, into shots/ at device scale 2.
# Usage: ./render.sh [dark|light]
set -euo pipefail
cd "$(dirname "$0")"
scheme="${1:-dark}"
mkdir -p shots
shoot() { # <out> <width> <height> <extra query>
  chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size="$2,$3" --virtual-time-budget=3000 \
    --screenshot="$(pwd)/shots/$1" "file://$(pwd)/board.html?still&scheme=${scheme}$4" 2>/dev/null
  echo "shots/$1"
}
shoot "board-${scheme}.png" 1700 2900 ""
shoot "now-${scheme}.png" 1700 330 "&only=Now"
for key in A B C; do
  shoot "${key}-${scheme}.png" 1700 760 "&only=${key}"
done
