#!/usr/bin/env nix
#!nix shell nixpkgs#imagemagick nixpkgs#resvg --command bash
# Review sheet for the generated icons: each app icon on light and dark
# grounds, the tab icon at 1x and the Fold's 2.625x enlarged with no
# smoothing, the ICO layers, a circle crop of the maskable icon, and one
# portrait and one landscape splash screen.
set -euo pipefail
cd "$(dirname "$0")/../public"
out=${1:-/tmp/brand-icons}
mkdir -p "$out"
t=$(mktemp -d)
grounds=("#ffffff" "#2a2b2e")
for g in "${grounds[@]}"; do
  n=${g#\#}
  magick -size 240x240 "xc:$g" \( icon-512.png -resize 200x200 \) -gravity center -composite "$t/any-$n.png"
  magick -size 240x240 "xc:$g" \( icon-maskable-512.png -resize 200x200 \( -size 200x200 xc:black -fill white -draw "circle 100,100 100,0" \) -alpha off -compose copy_opacity -composite \) -compose over -gravity center -composite "$t/mask-$n.png"
  magick -size 240x240 "xc:$g" \( icon-monochrome-512.png -resize 200x200 -fill '#888' -colorize 100 \) -gravity center -composite "$t/mono-$n.png"
  magick -size 240x240 "xc:$g" \( apple-touch-icon.png -resize 200x200 \( -size 200x200 xc:black -fill white -draw "roundrectangle 0,0 199,199 45,45" \) -alpha off -compose copy_opacity -composite \) -compose over -gravity center -composite "$t/apple-$n.png"
done
resvg --width 16 favicon.svg "$t/tab16.png"
resvg --width 42 favicon.svg "$t/tab42.png"
magick "$t/tab16.png" -filter point -resize 1500% -background '#888' -gravity center -extent 240x240 "$t/tab16x.png"
magick "$t/tab42.png" -filter point -resize 550% -background '#888' -gravity center -extent 240x240 "$t/tab42x.png"
magick favicon.ico "$t/ico.png"
magick "$t/ico-0.png" -filter point -resize 1400% -background '#888' -gravity center -extent 240x240 "$t/ico16x.png"
magick "$t/ico-1.png" -filter point -resize 700% -background '#888' -gravity center -extent 240x240 "$t/ico32x.png"
magick -size 240x240 xc:'#e9e7e2' \( safari-pinned-tab.svg -resize 160x160 \) -gravity center -composite "$t/pinned.png"
magick splash/apple-splash-1179x2556.png -resize x240 -background '#888' -gravity center -extent 240x240 "$t/splash-p.png"
magick splash/apple-splash-2556x1179.png -resize 240x -background '#888' -gravity center -extent 240x240 "$t/splash-l.png"
magick montage -label "" \
  "$t"/any-ffffff.png "$t"/mask-ffffff.png "$t"/mono-ffffff.png "$t"/apple-ffffff.png "$t"/tab16x.png "$t"/tab42x.png \
  "$t"/any-2a2b2e.png "$t"/mask-2a2b2e.png "$t"/mono-2a2b2e.png "$t"/apple-2a2b2e.png "$t"/ico16x.png "$t"/ico32x.png \
  "$t"/pinned.png "$t"/splash-p.png "$t"/splash-l.png \
  -tile 6x -geometry +8+8 -background '#666' "$out/sheet.png" 2>/dev/null || true
rm -rf "$t"
echo "$out/sheet.png"
