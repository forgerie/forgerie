#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium nodejs_22
# Screenshot the transcript parked on a landmark.
# Usage: ./capture-region.sh <session> <fold|fold-open|user|system> <out.png> [w] [h]
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p live
exec node ./capture-region.mjs "$@"
