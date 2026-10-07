#!/usr/bin/env -S /run/current-system/sw/bin/nix shell nixpkgs#bash nixpkgs#coreutils nixpkgs#jq nixpkgs#procps -c bash
# Kill the spike with SIGKILL at a chosen point, then resume from storage.
#   crash-test.sh <name> <marker-file|seconds>
# marker-file: kill once the file appears (a tool started). seconds: kill after N s.
set -uo pipefail
cd "$(dirname "$0")"
name=$1 when=$2 dir=state/$name
rm -rf "$dir"; mkdir -p "$dir"
quiet() { grep -v -i -E "experimental|trace-warnings"; }

./spike.mjs run "$dir" > >(quiet > "$dir/run.out") 2>&1 &
launcher=$!
if [[ $when =~ ^[0-9]+$ ]]; then sleep "$when"; else
  for _ in $(seq 1 1200); do [ -e "$dir/$when" ] && break; sleep 0.1; done
  sleep 2
fi
pid=$(pgrep -f "spike.mjs run $dir" | while read -r p; do [ "$(cat /proc/$p/comm)" = node ] && echo "$p"; done | head -1)
kill -KILL "$pid"; wait "$launcher" 2>/dev/null
echo "== $name: SIGKILLed node $pid"
cat "$dir/run.out"

./spike.mjs resume "$dir" 2>&1 | quiet
echo "resume exit=${PIPESTATUS[0]}"
echo "-- tool attempts (taskId phase pid)"
jq -r '"\(.tool) task=\(.taskId) \(.phase) pid=\(.pid)"' "$dir/attempts.log"
echo "-- permanent.log lines: $(wc -l < "$dir/permanent.log" 2>/dev/null || echo 0)"
echo "-- same submission across processes: run=$(cat "$dir/submission-run" 2>/dev/null) resume=$(cat "$dir/submission-resume")"
echo "-- transcript (oldest first)"
jq -r '.entries | reverse[] | "\(.kind)  \(.text[0:170])"' "$dir/result-resume.json"
