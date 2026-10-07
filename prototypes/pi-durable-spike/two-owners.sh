#!/usr/bin/env -S /run/current-system/sw/bin/nix shell nixpkgs#bash nixpkgs#coreutils nixpkgs#jq nixpkgs#procps -c bash
# Open the same storage from a second process while the first is mid-run.
set -uo pipefail
cd "$(dirname "$0")"
dir=state/two-owners
rm -rf "$dir"; mkdir -p "$dir"
quiet() { grep -v -i -E "experimental|trace-warnings"; }
./spike.mjs run "$dir" > >(quiet > "$dir/first.out") 2>&1 &
first=$!
for _ in $(seq 1 600); do [ -e "$dir/in-fetch_reading" ] && break; sleep 0.1; done
echo "== second process opens the same storage while the first runs a tool"
timeout 60 ./spike.mjs resume "$dir" 2>&1 | quiet | tail -6
echo "second exit=${PIPESTATUS[0]}"
wait "$first"; echo "first exit=$?"
cat "$dir/first.out"
echo "-- tool attempts"
jq -r '"\(.tool) task=\(.taskId) \(.phase) pid=\(.pid)"' "$dir/attempts.log"
echo "-- permanent.log lines: $(wc -l < "$dir/permanent.log" 2>/dev/null || echo 0)"
