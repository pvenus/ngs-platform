# NGS local application

Production source for the standalone local NGS project workspace. Node.js 24 or later; no npm dependencies.

```sh
npm test
NGS_AUDIO_WORKSPACE_ENABLED=1 npm start
```

The service listens on local port 5274 by default and uses separately operated PDS and Request Service loopback MCP endpoints (8030 and 8770). Keep the catalog replica outside this Git tree. Set `NGS_BRAND_MARK_PATH` to an optional local PNG if you want to use your own logo. With no local logo the application starts normally.

This directory contains source, tests and a source-integrity manifest only. Do not commit runtime databases, generated media, project data, private deployment settings or credentials.

### Space project catalog owner relay (staged)

This Mac-only command is separate from local NGS and must not run from a
hosted Worker. It uses the already signed-in installed ChatGPT Codex MCP
connection for the exact NGS Site and reads only the existing local PDS MCP
port. It does not start a listener, prompt for credentials, open Filex
directly, call RS, or upload a project snapshot.

- Harmless readiness: `node ngs-local/sites/npcgen/build/space-catalog-worker.mjs --readiness`.
  Reads hosted pending request availability and canonical Binari summary,
  but never replies to a request.
- Explicit operation after review: same command with `--watch`.
  It replies only to unexpired exact hosted catalog IDs under the existing
  authenticated owner command. The only nonempty result is Binari project
  ID plus canonical name, with no icon for this first repair. The Site
  rechecks TTL and delivery. Source or approval errors leave it unavailable.

The current clean hosted release must enable this exact owner-only command
pair before readiness can succeed. Do not widen Site access or install a
replacement credential when the existing owner transport is unavailable.
