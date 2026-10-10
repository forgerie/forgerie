#!/usr/bin/env nix
#!nix shell nixpkgs#imagemagick --command bash
# Put every candidate's 512 px light and dark icon side by side, in the
# order given, so shapes can be compared at one size.
set -euo pipefail
cd "$(dirname "$0")"
files=()
for id in "$@"; do files+=("shots/$id-light-512.png" "shots/$id-dark-512.png"); done
magick montage -label "" "${files[@]}" -tile 6x -geometry 256x256+8+8 -background '#888' shots/explore.png 2>/dev/null || true
echo "wrote shots/explore.png"
