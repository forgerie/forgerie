#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium nodejs imagemagick
# Render the mockup into shots/, then three labelled sheets:
#   sizes-<scheme>.png         the Review state at six sizes
#   states-wide-<scheme>.png   every other state at 1180 x 820
#   states-narrow-<scheme>.png every other state at 475 x 638
# Usage: ./render.sh [origin] [light|dark]
# The ui dev server must run with caliper(): cd ui && npm run dev
set -euo pipefail
cd "$(dirname "$0")"
origin="${1:-http://localhost:8510}"
scheme="${2:-light}"
CHROMIUM="$(command -v chromium)" node shoot.mjs "$origin" "$scheme"

font="$(nix build --no-link --print-out-paths nixpkgs#dejavu_fonts)/share/fonts/truetype/DejaVuSans.ttf"
if [ "$scheme" = dark ]; then paper="#1b1b19"; ink="#a9a9a3"; else paper="#e4e4df"; ink="#55554f"; fi
tile() { # <shot> <label> <out>
  magick "shots/$1-${scheme}.png" -resize 50% -background "$paper" -gravity north -splice 0x44 \
    -font "$font" -pointsize 22 -fill "$ink" -annotate +0+8 "$2" "$3"
}

tile size-desktop "Desktop, 1440 x 900" shots/.t1.png
tile size-tablet "Tablet, 1180 x 820" shots/.t2.png
tile size-fold-open-landscape "Fold open, landscape, 932 x 553" shots/.t3.png
tile size-fold-open-portrait "Fold open, portrait, 704 x 783" shots/.t4.png
tile size-fold-closed-portrait "Fold closed, portrait, 475 x 638" shots/.t5.png
tile size-fold-closed-landscape "Fold closed, landscape, 711 x 374" shots/.t6.png
magick shots/.t1.png shots/.t2.png -background "$paper" -gravity north +smush 48 shots/.r1.png
magick shots/.t3.png shots/.t4.png shots/.t5.png shots/.t6.png -background "$paper" -gravity north +smush 48 shots/.r2.png
magick shots/.r1.png shots/.r2.png -background "$paper" -gravity northwest -smush 56 -bordercolor "$paper" -border 48 "shots/sizes-${scheme}.png"
echo "shots/sizes-${scheme}.png"

states=(AtAStage "Scrolled to a stage" EditedInputs "Edited inputs" InputsOpen "Inputs open" Reading "Reading" ReadFailed "Read failed"
  AnotherRunActive "Another run active" Starting "Starting" StartFailed "Start failed" AskForChanges "Ask for changes"
  ChangesSent "Changes sent" Started "Started" Dismissed "Dismissed" Replaced "Replaced" ProseOnly "Prose only, no stages")
for width in wide narrow; do
  per=4; [ "$width" = narrow ] && per=7
  rows=(); row=(); i=0
  for ((n = 0; n < ${#states[@]}; n += 2)); do
    tile "state-${width}-${states[n]}" "${states[n+1]}" "shots/.s${i}.png"
    row+=("shots/.s${i}.png"); i=$((i + 1))
    if [ "${#row[@]}" -eq "$per" ] || [ $((n + 2)) -ge "${#states[@]}" ]; then
      magick "${row[@]}" -background "$paper" -gravity north +smush 40 "shots/.row${#rows[@]}.png"
      rows+=("shots/.row${#rows[@]}.png"); row=()
    fi
  done
  magick "${rows[@]}" -background "$paper" -gravity northwest -smush 56 -bordercolor "$paper" -border 48 "shots/states-${width}-${scheme}.png"
  echo "shots/states-${width}-${scheme}.png"
done
rm -f shots/.t*.png shots/.r*.png shots/.s*.png shots/.row*.png
