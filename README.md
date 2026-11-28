# NGS Platform

This is a buildable, loopback-previewable source-only frontend snapshot,
not a complete operating NGS installation. It derives from
runtime source revision `09836498ed936d070cd0773de9f6a4ab1a256f13`.

## Install, compile and preview

Use Node 22.13+ and Python 3.9+. Node 24.21.0/npm 11.19.0 were tested on Apple Silicon.

```sh
cd sites/npcgen
npm run install:ci
npm run build
cd ../..
node dev/preview-clean.mjs 8788
```

Open `http://127.0.0.1:8788`. Stop the preview with Ctrl-C. The preview is local
only; it passes no owner credentials and disables remote bindings. Its file
watcher uses one-second polling to avoid the macOS sandbox watch-descriptor limit.
No global OS or package-manager security setting is changed.

Compilation creates a new `.dev-runtime/space-candidate-*` directory, marked
`configuration: unconfigured`, `deployable: false`, `backendConnected: false`.
It checks the npm lock installation, TypeScript, RSC/client and SSR builds.
The archive intentionally contains no dependencies or compiled artifacts.

## What this can and cannot do

The UI shell loads. It has no authenticated user, projects, private transport,
local service gateway, business database, model or worker. API/MCP calls and
login routes return 503; writes, including server actions, return 405.
Those are intentional boundaries, not a suggestion to bypass authentication.
Do not select this bundle as an operational NGS runtime or copy its empty settings
over an existing installation. Connect real services only through separately
reviewed identity, authorization, data and transport configuration.

The export contains the UI entry import closure, not every legacy application
route. Existing user/grant/site settings were replaced with empty disabled
values; generated release stamps were cleared. Some game-specific display text
was generalized. Proprietary branding images, media, game data, prompt-package
payloads, app/API/MCP route implementations, backend/worker implementations,
private settings, models and Git history are absent.

A compilation and loopback health pass is not a complete UI/content acceptance
test. Large-chunk and dynamic-import compiler warnings remain. On npm 11.19.0,
seven dependencies reported lifecycle scripts without allowScripts coverage;
no persistent approval was added. Check a newer npm policy separately rather
than disabling it globally.

Read THIRD-PARTY-NOTICES.md and LICENSE-STATUS.md for source and third-party terms.

## Runtime prerequisite tools

Optional pinned macOS arm64 Python, uv and Node preparers are in
[tools/runtime-prerequisites](tools/runtime-prerequisites/README.md).
They do not activate backend services or download model weights.

## Project split

NGS is the request/copy-oriented frontend. Backend orchestration belongs to
`ngs-services`; functional workers belong to the single `ngs-workers` project.
Those projects are separate setup dependencies, not bundled implementations here.

## Repository boundaries

Only source and configuration templates are published. Generated images, audio,
video, databases, model weights, private operational settings and old Git history
are excluded. This publication does not change existing local services.

## Local NGS production source

The current standalone local application is in [ngs-local](ngs-local/README.md). Runtime data and credentials are not included.

## NGS Viewer for team members

[ngs-viewer](ngs-viewer/README.md) runs on a teammate’s own machine using the
shared Space workspace UI. Official requests go only through the existing Space
session; a verified copy of Space-published files is stored in a user-selected
local P2 folder. It does not join OPS or run local production services.
