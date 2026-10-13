#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium nodejs imagemagick
# Render every layout at every size into shots/, then one labelled sheet per layout.
# Usage: ./render.sh [origin] [light|dark]
# The ui dev server must run with caliper(): cd ui && npm run dev
set -euo pipefail
cd "$(dirname "$0")"
origin="${1:-http://localhost:8510}"
scheme="${2:-light}"
CHROMIUM="$(command -v chromium)" node shoot.mjs "$origin" "$scheme"

font="$(nix build --no-link --print-out-paths nixpkgs#dejavu_fonts)/share/fonts/truetype/DejaVuSans.ttf"
if [ "$scheme" = dark ]; then paper="#1b1b19"; ink="#a9a9a3"; else paper="#e4e4df"; ink="#55554f"; fi
tile() { # <key> <size> <label> -> shots/.tile-<size>.png
  magick "shots/$1-$2-${scheme}.png" -resize 50% -background "$paper" -gravity north -splice 0x44 \
    -font "$font" -pointsize 22 -fill "$ink" -annotate +0+8 "$3" "shots/.tile-$2.png"
}
for key in A B C; do
  tile "$key" desktop "Desktop, 1440 x 900"
  tile "$key" tablet "Tablet, 1180 x 820"
  tile "$key" fold-open-landscape "Fold open, landscape, 932 x 553"
  tile "$key" fold-open-portrait "Fold open, portrait, 704 x 783"
  tile "$key" fold-closed-portrait "Fold closed, portrait, 475 x 638"
  tile "$key" fold-closed-landscape "Fold closed, landscape, 711 x 374"
  magick shots/.tile-desktop.png shots/.tile-tablet.png -background "$paper" -gravity north +smush 48 shots/.row1.png
  magick shots/.tile-fold-open-landscape.png shots/.tile-fold-open-portrait.png shots/.tile-fold-closed-portrait.png \
    shots/.tile-fold-closed-landscape.png -background "$paper" -gravity north +smush 48 shots/.row2.png
  magick shots/.row1.png shots/.row2.png -background "$paper" -gravity northwest -smush 56 \
    -bordercolor "$paper" -border 48 "shots/${key}-sheet-${scheme}.png"
  rm -f shots/.tile-*.png shots/.row1.png shots/.row2.png
  echo "shots/${key}-sheet-${scheme}.png"
done
