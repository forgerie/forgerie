#!/usr/bin/env nix-shell
#!nix-shell -i bash -p imagemagick
# Report the first x column that carries ink inside a horizontal band.
# Usage: measure-ink-edge.sh <png> <x0> <width> <y0> <height> [threshold]
set -euo pipefail

png="${1:?png required}"
x0="${2:?x0 required}"
w="${3:?width required}"
y0="${4:?y0 required}"
h="${5:?height required}"
threshold="${6:-170}"

magick "$png" -crop "${w}x${h}+${x0}+${y0}" +repage -colorspace gray -depth 8 txt:- 2>/dev/null \
  | sed -n 's/^\([0-9]\+\),[0-9]\+: (\([0-9]\+\)).*/\1 \2/p' \
  | awk -v x0="$x0" -v t="$threshold" '{ if ($2+0 < t) { if (min=="" || $1+0 < min) min=$1+0 } } END { if (min=="") print "no ink"; else print x0+min }'
