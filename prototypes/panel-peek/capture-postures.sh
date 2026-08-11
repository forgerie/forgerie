#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium
# Capture the acceptance-device posture matrix (AGENTS.md) plus a desktop
# reference against the locally running Forgerie instance.
set -euo pipefail

URL="${1:-http://127.0.0.1:8504/}"
OUT="${2:-/tmp/fg-shots}"

rm -rf "$OUT"
mkdir -p "$OUT"

postures=(
  "739,979:unfolded-portrait"
  "979,739:unfolded-landscape"
  "499,789:folded-portrait"
  "789,499:folded-landscape"
  "1440,900:desktop-resident"
  "1100,900:desktop-summoned"
)

for entry in "${postures[@]}"; do
  size="${entry%%:*}"
  name="${entry##*:}"
  chromium \
    --headless=new \
    --disable-gpu \
    --no-sandbox \
    --hide-scrollbars \
    --window-size="$size" \
    --virtual-time-budget=9000 \
    --screenshot="$OUT/$name.png" \
    "$URL" >/dev/null 2>&1
  printf '%s -> %s/%s.png\n' "$size" "$OUT" "$name"
done
