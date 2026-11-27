# C# water puzzle architecture proof

The core UPM assembly has no Unity references. The Unity JSON adapter, CLI
validator, and browser exports all use the same engine. The document worker
is the author of the definition and replay trace; the validator takes only
bounded JSON stdin and replays it before any v4 publication. V4 intentionally
tests the existing water interactions, preserving the old puzzle. It is not
a general-purpose composition feature release.

Native smoke: `dotnet run --project tools/puzzle-core/smoke/Smoke.csproj`.
Compile the CLI validator with `dotnet build -c Release -o <cli>` in validator.
Build the browser harness with `dotnet publish -c Release -o <wasm>` in browser.
On machines with the compatible browser runtime and WebAssembly packs already
cached but no wasm-tools workload, this interpreted release is built without
native/AOT rebuilding using `-p:MSBuildEnableWorkloadResolver=false
-p:WasmEnableWebcil=false`. Do not change the installed production SDK.
The harness and fixture go in the output wwwroot; run through loopback, not
file://. `stage-pack.py <wasm> <cli> <new-bundle-dir>` makes the checksum
index and minimal validator closure. Stage artifacts outside source control,
as immutable application runtime outputs via OPS. NGS Local enables the v4
option only with a verified browser pack. Hosted NGS remains on v1–v3 until
it has the same runtime artifact path. There is no v4 JavaScript fallback.
