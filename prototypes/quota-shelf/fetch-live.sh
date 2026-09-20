#!/usr/bin/env bash
# Pulls the live quota payload and writes it as a plain script the prototype
# pages can load over file://, where fetch() of a .json is blocked.
#
#   ./prototypes/quota-shelf/fetch-live.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
url="${QUOTA_URL:-https://cliproxyapi.hummingbird-lake.ts.net/quota}"
out="$here/live.js"

body="$(curl -fsS --max-time 20 "$url")"

{
  printf '/* Live quota payload, fetched %s from %s.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$url"
  printf '   Written by fetch-live.sh. Do not edit by hand. */\n'
  printf 'window.QUOTA_LIVE = '
  printf '%s' "$body"
  printf ';\n'
  printf 'window.QUOTA_LIVE_FETCHED_AT = %s;\n' "$(date -u +%s)000"
} > "$out"

printf 'wrote %s (%s bytes)\n' "$out" "$(wc -c < "$out")"
printf '%s' "$body" | nix shell nixpkgs#jq --command jq -r '
  "updatedAt: \(.updatedAt // "?")",
  (.providers[]? | "provider \(.id) · \(.name) · \(.accounts | length) account(s)"),
  (.providers[]?.accounts[]? | "  \(.email // "?") selected=\(.selected) available=\(.available) windows=\([.windows[]?.name] | join(","))")
'
