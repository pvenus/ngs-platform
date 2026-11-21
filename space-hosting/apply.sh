#!/bin/bash
set -euo pipefail
src="$(cd "$(dirname "$0")"/.. && pwd)"
target="$1"
# Optional SHA comes from the separately verified canonical preparation receipt.
# Never stamp a Sites scaffold SHA or infer provenance from a moving checkout.
commit_sha="${2:-}"
test "$#" -le 2
if [ -n "$commit_sha" ]; then
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]]
  test "$(git -C "$src" rev-parse --show-toplevel)" = "$src"
  test "$(git -C "$src" remote get-url origin)" = https://github.com/pvenus/ngs-platform.git
  test "$(git -C "$src" rev-parse --verify "$commit_sha^{commit}")" = "$commit_sha"
  snapshot="$(mktemp -d "${TMPDIR:-/tmp}/ngs-space-source.XXXXXX")"
  trap 'rm -rf "$snapshot"' EXIT
  git -C "$src" archive "$commit_sha" ngs-local space-hosting/overlay | tar -x -C "$snapshot"
  src="$snapshot"
fi
test -f "$target/.openai/hosting.json"
test -f "$target/build/clean-space-guard.mjs"
test -f "$target/public/assets/vinus-mark.png"
mkdir -p "$target/ngs-local"
# Mac S3 dependencies are runtime-only and never part of the hosted artifact.
test ! -e "$target/ngs-local/node_modules" && test ! -L "$target/ngs-local/node_modules"
tar -C "$src/ngs-local" --exclude './node_modules' -cf - . | tar -C "$target/ngs-local" -xf -
test ! -e "$target/ngs-local/node_modules" && test ! -L "$target/ngs-local/node_modules"
test ! -L "$target/build/ngs-release-provenance.mjs"
cp -R "$src/space-hosting/overlay/." "$target/"
if [ -n "$commit_sha" ]; then
  test -f "$target/build/ngs-release-provenance.mjs"
  printf "export const ngsCommitSha='%s';\n" "$commit_sha" > "$target/build/ngs-release-provenance.mjs"
fi
# One unchanged SQL authority for Local SQLite and the applied Site migration.
for migration in 0014_space_file_replica_versions.sql 0015_replica_sync_progress.sql; do
  test ! -L "$target/drizzle/$migration"
  cp "$src/ngs-local/dev/$migration" "$target/drizzle/$migration"
  cmp "$target/ngs-local/dev/$migration" "$target/drizzle/$migration"
done
test ! -L "$target/ngs-local"
if [ -e "$target/app/page.tsx" ]; then
  rm "$target/app/page.tsx"
fi
