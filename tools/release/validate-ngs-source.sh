#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test "$(node --version)" = v24.21.0
export NGS_MINIFLARE_TEST_PACKAGE_JSON="$PWD/ngs-local/local-miniflare/package.json"
export SPACE_TEST_PACKAGE_JSON="$NGS_MINIFLARE_TEST_PACKAGE_JSON"

python3 -B -m unittest discover -s tools/release -p 'test_prepare_ngs_release.py'
# The Local suite skips integrations requiring separate, intentionally
# unavailable live/deployment services; the Local Workerd fixture is enabled.
npm --prefix ngs-local test
node --test --test-concurrency=1 \
  space-hosting/overlay/tests/{space-npc-workspace,space-npc-shared-cache,space-npc-media-cache,space-file-replica}.mjs

# Machine queue imports the Local wire contracts from the deployed overlay layout.
hosted_queue="$(mktemp -d)"
trap 'rm -rf "$hosted_queue"' EXIT
cp -R space-hosting/overlay/. "$hosted_queue/"
ln -s "$PWD/ngs-local" "$hosted_queue/ngs-local"
node --test "$hosted_queue/tests/"{space-machine-queue,shared-workspace-read-parity,shared-ngs-response}.mjs
