#!/usr/bin/env nix
#!nix shell nixpkgs#resvg --command bash
# Regenerate the PWA/touch icons from the favicon.svg master.
# The PNGs are generated files; edit favicon.svg and re-run this script.
set -euo pipefail

cd "$(dirname "$0")/../src/client/public"

# The paper background is baked into favicon.svg; no --background needed.
resvg --width 512 --height 512 favicon.svg pwa-icon-512.png
resvg --width 192 --height 192 favicon.svg pwa-icon-192.png
resvg --width 180 --height 180 favicon.svg apple-touch-icon.png

echo "Icons regenerated in $(pwd)"
