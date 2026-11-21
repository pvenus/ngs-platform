#!/bin/bash
set -euo pipefail
src="$(cd "$(dirname "$0")"/.. && pwd)"
target="$1"
test -f "$target/.openai/hosting.json"
test -f "$target/build/clean-space-guard.mjs"
test -f "$target/public/assets/vinus-mark.png"
mkdir -p "$target/ngs-local"
cp -R "$src/ngs-local/." "$target/ngs-local/"
cp -R "$src/space-hosting/overlay/." "$target/"
test ! -L "$target/ngs-local"
if [ -e "$target/app/page.tsx" ]; then
  rm "$target/app/page.tsx"
fi
