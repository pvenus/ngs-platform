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

### Local NGS queue consumer (staged)

`node ngs-local/sites/npcgen/build/rs-mcp.mjs --watch` consumes only the separate
local NGS queue MCP at `127.0.0.1:5275/mcp` and existing Request Service MCP at
`127.0.0.1:8770/mcp`. `--once` performs one bounded batch and can submit actual
rows; it is not a dry run. No consumer runs through the browser port. The
queue and consumer use the existing OS-loopback trust boundary, not a
per-process credential. A full page advances an opaque seek cursor before
the next one-second tick; rejected or unresolved early rows do not block
unrelated later requests.

Each NGS row supplies one unguessable `ngs.local.<UUIDv4>` used unchanged as the
RS idempotency key. The consumer checks the exact returned official ID and
registered status before sending an ACK. NGS then retains a bounded receipt
and removes only the verified row's payload. A negative RS response or a
transport error does not remove the row. If NGS ACK fails after a valid RS
reply, the running consumer retries only ACK using that already verified proof.

An uncertain submit is safe to repeat with the same key. The existing RS
returns the existing receipt while its state is registered, but throws
idempotency conflict if it already advanced; summary/list does not prove its
immutable payload. In that case the consumer backs off, counts the row as
unresolved and retains it. Do not mint a second key, infer acceptance from a
derived ID, drop the draft, or inspect an RS database to reconcile it. Resolution
after process restart may require an approved future exact receipt lookup
('same source, original key, request type and payload digest'); none is added.
Routine idle delay is one second, independent of any file sync schedule.
