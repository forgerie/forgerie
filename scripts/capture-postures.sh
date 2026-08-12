#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium
# Capture the four acceptance postures of the Galaxy Z Fold for visual review.
# Usage: capture-postures.sh <url> <out-prefix>
set -euo pipefail

url="${1:?url required}"
prefix="${2:?output prefix required}"

capture() {
  local name="$1" size="$2"
  chromium --headless=new --disable-gpu --hide-scrollbars \
    --window-size="$size" \
    --screenshot="${prefix}-${name}.png" \
    --virtual-time-budget=12000 \
    "$url" >/dev/null 2>&1
  echo "${prefix}-${name}.png"
}

capture unfolded-portrait 704,783
capture unfolded-landscape 932,553
capture folded-portrait 475,638
capture folded-landscape 711,374
capture desktop 1600,1000
