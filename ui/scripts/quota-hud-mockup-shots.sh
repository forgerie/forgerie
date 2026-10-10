#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium nixpkgs#bash -c bash
# Capture the Quota HUD mockup: the sidebar, then the detail sheet in each
# drawing, at all four Fold postures and both schemes. Run from the checkout
# root with the ui dev server up:
#   APP_URL=http://127.0.0.1:8561/ ui/scripts/quota-hud-mockup-shots.sh
set -euo pipefail
app="${APP_URL:-http://127.0.0.1:8561/}"
out="${OUT:-ui/verification/local/quota-hud}"
variants="${VARIANTS:-tiles strips schedule rings}"
schemes="${SCHEMES:-dark light}"
account="${ACCOUNT:-claude/work@example.com}"
export CHROME_BIN="${CHROME_BIN:-$(command -v chromium)}"
mkdir -p "$out"
for scheme in $schemes; do
  node scripts/capture-postures.mjs --url "${app}verification/quota-hud-mockup.html?state=hud" \
    --out "$out" --label "hud-$scheme" --color-scheme "$scheme" --settle 1200 | tail -n 1
  for variant in $variants; do
    node scripts/capture-postures.mjs --url "${app}verification/quota-hud-mockup.html?state=sheet&variant=$variant&account=$account" \
      --out "$out" --label "$variant-$scheme" --color-scheme "$scheme" --settle 1800 | tail -n 1
  done
done
