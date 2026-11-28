# C# water puzzle architecture proof

The core UPM assembly has no Unity references. The Unity JSON adapter, CLI
validator, and browser exports all use the same engine. The document worker
is the author of the definition and replay trace; the validator takes only
bounded JSON stdin and replays it before any v4 publication. V4 intentionally
tests the existing water interactions, preserving the old puzzle. It is not
a general-purpose composition feature release.

## Browser release

On the development Mac with approved .NET SDK 10.0.103 and browser runtime packs
installed, run `tools/puzzle-core/build-browser-release.sh`. It builds the
browser WASM and CLI validator from the same C# source, verifies the browser
members and writes one immutable, versioned `puzzle-core-bundle.mjs`. The
runtime ID is the SHA-256 of the file manifest; each member has its own digest.
Review and commit this generated runtime alongside related source changes and
refresh the NGS source manifests. The CLI validator remains a separate backend
artifact; this bundle does not replace the production validator.

Local, Space and Viewer ship that exact generated file with the app and serve
the same versioned browser runtime. No target builds from source or reads a
machine-specific core folder at runtime. Viewer enables a new proof request
only when its installed core version matches the Space session's version;
ordinary requests remain compatible with older Space deployments.
