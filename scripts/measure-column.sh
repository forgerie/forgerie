#!/usr/bin/env nix-shell
#!nix-shell -i bash -p nodejs_24 chromium
# Run the column measurement against a live Forgerie instance.
# Usage: measure-column.sh <url> <width>x<height> [...]
set -euo pipefail
exec node "$(dirname "$0")/measure-column.mjs" "$@"
