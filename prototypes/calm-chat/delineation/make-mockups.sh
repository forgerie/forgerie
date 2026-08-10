#!/usr/bin/env nix-shell
#!nix-shell -i bash -p nodejs_22 chromium
set -euo pipefail
cd "$(dirname "$0")"

node ./make-mockups.mjs

# Render each SVG so the variants can be judged as pictures, not as markup.
for svg in *.svg; do
  png="${svg%.svg}.png"
  height=$(sed -n '1s/.*height="\([0-9]*\)".*/\1/p' "$svg")
  chromium --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=739,"${height}" \
    --screenshot="$png" \
    --virtual-time-budget=4000 \
    "file://$PWD/$svg" 2>/dev/null
  echo "rendered $png (739x${height})"
done
