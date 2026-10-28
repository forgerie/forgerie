#!/usr/bin/env nix-shell
#!nix-shell -i bash -p imagemagick
# Join one scene's four posture shots into one sheet, at half size.
# Usage: ./sheet.sh [dark|light] scene ...   (run ./render.sh first)
set -euo pipefail
cd "$(dirname "$0")/shots"
scheme="${1:-light}"; shift || true
for scene in "$@"; do
  shots=()
  for posture in unfolded-portrait unfolded-landscape folded-portrait folded-landscape; do
    shots+=( \( "${scheme}-${scene}-${posture}.png" -resize 40% -bordercolor '#c8c8c4' -border 2 \) )
  done
  magick -background '#e4e4e0' "${shots[@]}" -gravity south -splice 0x0 +append -bordercolor '#e4e4e0' -border 16 "sheet-${scheme}-${scene}.png"
  echo "shots/sheet-${scheme}-${scene}.png"
done
