#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$repo_root"

npm install
npm run build
npm link
forgerie install --dev
