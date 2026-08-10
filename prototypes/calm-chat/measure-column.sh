#!/usr/bin/env nix-shell
#!nix-shell -i bash -p chromium nodejs_22
# Report real transcript column metrics from the running instance.
# Usage: ./measure-column.sh <session-id> [width] [height]
set -euo pipefail

cd "$(dirname "$0")"
exec node ./measure-column.mjs "$@"
