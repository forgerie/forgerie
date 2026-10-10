#!/usr/bin/env nix
#!nix shell nixpkgs#resvg nixpkgs#imagemagick --command bash
# Render each tab icon at 42 device pixels (16 CSS px at the Fold's DPR
# 2.625) and at 16 px (a DPR 1 screen), then enlarge both with no
# smoothing so the real pixels are visible.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
row=()
for id in run sq4-full sq4-short sq5-full sq5-short sq5-bold; do
  for scheme in light dark; do
    resvg --width 42 --height 42 "marks/$id-$scheme-tab.svg" "$tmp/$id-$scheme-42.png"
    resvg --width 16 --height 16 "marks/$id-$scheme-tab.svg" "$tmp/$id-$scheme-16.png"
    magick "$tmp/$id-$scheme-42.png" -filter point -resize 400% "$tmp/$id-$scheme-42x.png"
    magick "$tmp/$id-$scheme-16.png" -filter point -resize 1050% "$tmp/$id-$scheme-16x.png"
    row+=("$tmp/$id-$scheme-42x.png" "$tmp/$id-$scheme-16x.png")
  done
done
magick montage -label "" "${row[@]}" -tile 4x -geometry +12+12 -background '#888' shots/tab-zoom.png
rm -rf "$tmp"
echo "wrote shots/tab-zoom.png"
