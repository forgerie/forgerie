#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium
# Render current/proposed at two Fold postures from AGENTS.md.
#
# --window-size is the OUTER window (see prototypes/capture.sh): headless
# chromium renders a smaller viewport than requested and crops the right
# edge. Measure the offset with ../probe.html and compensate.
set -euo pipefail

cd "$(dirname "$0")"

run_chrome() {
  chromium --headless=new --disable-gpu --no-sandbox --hide-scrollbars "$@" 2>/dev/null
}

PROBE_W=1000
PROBE_H=800
PROBE="$(run_chrome --window-size="${PROBE_W},${PROBE_H}" --virtual-time-budget=2000 \
  --dump-dom "file://$(pwd)/../probe.html" | grep -o 'VIEWPORT [0-9]*x[0-9]*' | head -n 1)"
ACTUAL_W="${PROBE#VIEWPORT }"; ACTUAL_W="${ACTUAL_W%x*}"
ACTUAL_H="${PROBE##*x}"
OFFSET_W=$(( PROBE_W - ACTUAL_W ))
OFFSET_H=$(( PROBE_H - ACTUAL_H ))
echo "window-chrome offset: ${OFFSET_W}w ${OFFSET_H}h"

postures=(
  "folded-portrait 475 638"
  "unfolded-landscape 932 553"
)

for page in current index; do
  for posture in "${postures[@]}"; do
    read -r name width height <<<"$posture"
    out="${page}-${name}.png"
    run_chrome \
      --force-device-scale-factor=2 \
      --window-size="$(( width + OFFSET_W )),$(( height + OFFSET_H ))" \
      --screenshot="${out}" \
      --virtual-time-budget=4000 \
      "file://$(pwd)/${page}.html" >/dev/null
    echo "wrote ${out} (${width}x${height})"
  done
done
