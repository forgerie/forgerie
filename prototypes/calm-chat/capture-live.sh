#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium
# Capture the running instance across the Fold posture matrix from AGENTS.md.
# Usage: ./capture-live.sh <session-id> <label>
set -euo pipefail

cd "$(dirname "$0")"

session="${1:?session id required}"
label="${2:?label required}"
base="${FORGERIE_BASE:-http://127.0.0.1:8504}"
# A session route needs its project and workspace too, otherwise the app shows
# the "select a project and workspace" empty state instead of a transcript.
project="${FORGERIE_PROJECT:-597a5ae5-0921-4680-a78b-c6355f1fd593}"
workspace="${FORGERIE_WORKSPACE:-bfa36da0d1f5}"
out_dir="live"

mkdir -p "$out_dir"

postures=(
  "folded-portrait 499 789"
  "folded-landscape 789 499"
  "unfolded-portrait 739 979"
  "unfolded-landscape 979 739"
)

for posture in "${postures[@]}"; do
  read -r name width height <<<"$posture"
  out="${out_dir}/${label}-${name}.png"
  chromium \
    --headless=new \
    --disable-gpu \
    --no-sandbox \
    --hide-scrollbars \
    --window-size="${width},${height}" \
    --screenshot="${out}" \
    --virtual-time-budget=12000 \
    "${base}/?project=${project}&workspace=${workspace}&session=${session}" >/dev/null 2>&1
  echo "wrote ${out} (${width}x${height})"
done
