#!/usr/bin/env nix
#!nix shell nixpkgs#chromium nixpkgs#resvg --command bash
# Rebuild the marks, capture the contact sheet, and rasterise each mark at
# 512 px with resvg, the renderer scripts/generate-icons.sh uses.
set -euo pipefail
cd "$(dirname "$0")"
./build.mjs
mkdir -p shots
# Device scale 2 is close to the Fold's 2.625, so small icons render as on the phone.
chromium --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --force-device-scale-factor=2 --window-size=1500,2200 --screenshot="$PWD/shots/sheet.png" "file://$PWD/sheet.html" 2>/dev/null
for f in marks/*[!b].svg; do
  resvg --width 512 --height 512 "$f" "shots/$(basename "$f" .svg)-512.png"
done
echo "shots in $PWD/shots"
