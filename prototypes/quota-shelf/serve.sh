#!/usr/bin/env bash
# Serves the prototype pages over HTTP so they can be opened from another
# machine on the tailnet, rather than only over file:// on this one.
#
#   ./prototypes/quota-shelf/serve.sh [port]
#
# The pages load their data through plain <script> tags, so they work over
# both file:// and http://. Only live.js needs refreshing, via fetch-live.sh.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port="${1:-8531}"

python="$(command -v python3 || true)"
if [[ -z "$python" ]]; then
  python="$(nix build --no-link --print-out-paths nixpkgs#python3)/bin/python3"
fi

printf 'serving %s on http://%s:%s/\n' "$here" "$(hostname)" "$port"
exec "$python" -m http.server "$port" --bind 0.0.0.0 --directory "$here"
