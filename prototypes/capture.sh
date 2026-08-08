#!/usr/bin/env bash
#
# Capture the Fold 8 posture matrix for a prototype.
#
# Usage: ./capture.sh <prototype-dir-name> [out-dir]
#   ./capture.sh session-board /tmp/board
#
# Serves prototypes/ over HTTP (ES modules need a real origin), screenshots the
# four CSS viewports from AGENTS.md, then stops the server.
#
# Chromium's --window-size is the OUTER window, which includes browser chrome,
# so asking for 979x739 actually renders a 979x652 viewport. That silently
# invalidates posture testing, so this script measures the offset with probe.html
# and compensates instead of hardcoding a magic number.

set -euo pipefail

PROTOTYPE="${1:?usage: capture.sh <prototype-dir-name> [out-dir]}"
OUT_DIR="${2:-/tmp/forgerie-prototype-shots}"
PORT="${PORT:-8600}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CHROME="$(find /nix/store -maxdepth 3 -path '*playwright-chromium/chrome-linux64/chrome' -type f 2>/dev/null | head -n 1)"
if [[ -z "$CHROME" ]]; then
  echo "No chromium found in the nix store. Try: nix shell nixpkgs#chromium" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

node "$HERE/serve.mjs" "$HERE" "$PORT" >/dev/null &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if node -e "fetch('http://127.0.0.1:${PORT}/probe.html').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

run_chrome() {
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars "$@" 2>/dev/null
}

# Measure the window-chrome offset once, at a known request size.
PROBE_W=1000
PROBE_H=800
PROBE="$(run_chrome --window-size="${PROBE_W},${PROBE_H}" --virtual-time-budget=2000 \
  --dump-dom "http://127.0.0.1:${PORT}/probe.html" | grep -o 'VIEWPORT [0-9]*x[0-9]*' | head -n 1)"
ACTUAL_W="${PROBE#VIEWPORT }"; ACTUAL_W="${ACTUAL_W%x*}"
ACTUAL_H="${PROBE##*x}"
OFFSET_W=$(( PROBE_W - ACTUAL_W ))
OFFSET_H=$(( PROBE_H - ACTUAL_H ))

echo "Window-chrome offset: ${OFFSET_W}w ${OFFSET_H}h (probe asked ${PROBE_W}x${PROBE_H}, got ${ACTUAL_W}x${ACTUAL_H})"
echo "Capturing ${PROTOTYPE}:"

# Posture matrix from AGENTS.md (CSS pixels, DPR 2.5 working assumption).
capture() {
  local name="$1" width="$2" height="$3"
  run_chrome \
    --force-device-scale-factor=2 \
    --window-size="$(( width + OFFSET_W )),$(( height + OFFSET_H ))" \
    --screenshot="${OUT_DIR}/${PROTOTYPE}-${name}.png" \
    --virtual-time-budget=5000 \
    "http://127.0.0.1:${PORT}/${PROTOTYPE}/" >/dev/null
  echo "  ${name} — ${width}x${height} CSS px -> ${OUT_DIR}/${PROTOTYPE}-${name}.png"
}

capture unfolded-portrait 739 979
capture unfolded-landscape 979 739
capture folded-portrait 499 789
capture folded-landscape 789 499
