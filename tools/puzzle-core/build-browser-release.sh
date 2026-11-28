#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export DOTNET_CLI_TELEMETRY_OPTOUT=1
sdk="$(dotnet --version)"
[[ "$sdk" == 10.0.103 ]] || { echo "Use the approved SDK 10.0.103; found $sdk" >&2; exit 1; }
stage="$(mktemp -d "${TMPDIR:-/tmp}/ngs-csharp-release.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
dotnet publish tools/puzzle-core/browser/PuzzleBrowser.csproj -c Release -o "$stage/wasm" \
  --disable-build-servers -m:1 -p:UseSharedCompilation=false -p:MSBuildEnableWorkloadResolver=false -p:WasmEnableWebcil=false
dotnet build tools/puzzle-core/validator/PuzzleDefinitionValidator.csproj -c Release -o "$stage/validator" \
  --disable-build-servers -m:1 -p:UseSharedCompilation=false
python3 tools/puzzle-core/stage-pack.py "$stage/wasm" "$stage/validator" "$stage/bundle"
python3 tools/puzzle-core/release-browser-pack.py "$stage/bundle/browser" "$stage/puzzle-core-bundle.mjs"
# Replace only after both builds and the package's checks succeed.
mv "$stage/puzzle-core-bundle.mjs" ngs-local/sites/npcgen/build/puzzle-core-bundle.mjs
