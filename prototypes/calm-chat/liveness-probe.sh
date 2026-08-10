#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium nodejs_22
set -euo pipefail
cd "$(dirname "$0")"
exec node ./liveness-probe.mjs "$@"
