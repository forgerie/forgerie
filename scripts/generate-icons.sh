#!/usr/bin/env nix
#!nix shell nixpkgs#resvg --command bash
# Regenerate the PWA/touch icons from the favicon.svg master.
# The PNGs are generated files; edit favicon.svg and re-run this script.
set -euo pipefail

cd "$(dirname "$0")/../src/client/public"

BG='#111214' # --pi-bg, Forgerie Dark (docs/design-system.md)

resvg --background "$BG" --width 512 --height 512 favicon.svg pwa-icon-512.png
resvg --background "$BG" --width 192 --height 192 favicon.svg pwa-icon-192.png
resvg --background "$BG" --width 180 --height 180 favicon.svg apple-touch-icon.png

echo "Icons regenerated in $(pwd)"
