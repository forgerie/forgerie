#!/usr/bin/env nix-shell
#! nix-shell -i bash -p bash gnugrep
set -euo pipefail
trap 'rm -f -- "${0%.sh}.py" "$0"' EXIT
# Use the already deployed Python closure. Do not request a host Nix build.
python=$(grep -oE '/nix/store/[^[:space:]]+/bin/python3' /etc/github-actions/ready)
[[ "$python" == /nix/store/*/bin/python3 && -x "$python" ]]
"$python" "${0%.sh}.py"
