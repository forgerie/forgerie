#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium
# Render each mockup at the Fold posture matrix from AGENTS.md.
set -euo pipefail

cd "$(dirname "$0")"

postures=(
  "folded-portrait 499 789"
  "folded-landscape 789 499"
  "unfolded-portrait 739 979"
  "unfolded-landscape 979 739"
)

# "page[#fragment]:label" — the fragment scrolls the transcript to that anchor.
targets=(
  "01-today:01-today"
  "02-calm:02-calm"
  "02-calm#activity:02-calm-activity"
)

for target in "${targets[@]}"; do
  src="${target%%:*}"
  label="${target##*:}"
  for posture in "${postures[@]}"; do
    read -r name width height <<<"$posture"
    out="${label}-${name}.png"
    chromium \
      --headless=new \
      --disable-gpu \
      --no-sandbox \
      --hide-scrollbars \
      --window-size="${width},${height}" \
      --screenshot="${out}" \
      --virtual-time-budget=4000 \
      "file://$(pwd)/${src%%#*}.html${src#"${src%%#*}"}" >/dev/null 2>&1
    echo "wrote ${out} (${width}x${height})"
  done
done
