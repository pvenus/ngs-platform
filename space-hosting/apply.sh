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
# One unchanged SQL authority for Local SQLite and the applied Site migration.
test ! -L "$target/drizzle/0014_space_file_replica_versions.sql"
cp "$src/ngs-local/dev/0014_space_file_replica_versions.sql" "$target/drizzle/0014_space_file_replica_versions.sql"
cmp "$target/ngs-local/dev/0014_space_file_replica_versions.sql" "$target/drizzle/0014_space_file_replica_versions.sql"
test ! -L "$target/ngs-local"
if [ -e "$target/app/page.tsx" ]; then
  rm "$target/app/page.tsx"
fi
