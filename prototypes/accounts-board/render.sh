#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium
# Render the four board iterations at second-screen size (1920x1080) and one
# narrow size (932x553) to prove the intrinsic behavior.
#
# --window-size is the OUTER window (see prototypes/capture.sh): headless
# chromium renders a smaller viewport than requested, so measure the offset
# with ../probe.html and compensate.
set -euo pipefail

cd "$(dirname "$0")"
OUT_DIR="${1:-/tmp/accounts-board-shots}"
mkdir -p "$OUT_DIR"

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

sizes=(
  "monitor 1920 1080"
  "narrow 932 553"
)

for page in ${PAGES:-a-meters b-ledger c-horizon d-triage e-tanks f-trails g-dials i-reservoir}; do
  for size in "${sizes[@]}"; do
    read -r name width height <<<"$size"
    out="${OUT_DIR}/${page}-${name}.png"
    run_chrome \
      --window-size="$(( width + OFFSET_W )),$(( height + OFFSET_H ))" \
      --screenshot="${out}" \
      --virtual-time-budget=3000 \
      "file://$(pwd)/${page}.html" >/dev/null
    echo "wrote ${out} (${width}x${height})"
  done
done

# The runway board renders every state (skipped when PAGES narrows the run).
[ -n "${PAGES:-}" ] && exit 0
for scen in calm crunch idle dry stale; do
  out="${OUT_DIR}/h-runway-${scen}-monitor.png"
  run_chrome \
    --window-size="$(( 1920 + OFFSET_W )),$(( 1080 + OFFSET_H ))" \
    --screenshot="${out}" \
    --virtual-time-budget=3000 \
    "file://$(pwd)/h-runway.html?scenario=${scen}" >/dev/null
  echo "wrote ${out} (1920x1080)"
done
