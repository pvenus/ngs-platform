# Local NGS request handoff

NGS queues a validated submission in a local SQLite spool. Queuing is not RS
registration. Only the local RS consumer calls the MCP list/ack tools. It must
acknowledge only a successful, exact official receipt it obtained from RS,
never an inferred ID, rejected registration, or transport failure. The queue
also checks the receipt ID against the pending entry's original RS identity.
An unconfirmed entry stays pending across service restarts; there is no expiry
or automatic deletion of pending entries. The browser treats HTTP 202 as success and never waits for RS. The “로컬 요청 큐”
panel reads only pending queue metadata (project, type, enqueue time); it
refreshes while open, not as part of submitting. A verified acknowledgment
immediately removes the payload and entry from the pending list. A small
internal 15-minute dedup marker is not shown as request history.

Run the browser app and this separate service with the same absolute
`NGS_REQUEST_QUEUE_DB` path, in an existing private runtime directory outside
the repository; the queue creates a mode-0600 SQLite database and uses WAL.
Set `NGS_REQUEST_QUEUE_MCP_PORT` explicitly if the default 5275 is unavailable:

```sh
node ngs-local/sites/npcgen/build/local-request-queue-mcp.mjs
```

Bind only to `127.0.0.1`. Use the exact numeric Host and do not place this
service behind a tunnel/reverse proxy. Browser Origin, fetch-site, and
forwarding headers are rejected. This is a local OS trust boundary, not
per-process authentication: any allowed local process can use the endpoint.
The standard MCP tools are `ngs_request_queue_list` (up to 16 oldest pending
entries, repeatable and non-destructive; optional opaque cursor from the prior
full page as nextCursor) and `ngs_request_queue_ack`. The
spool backpressures at 128 retained entries, and queue reads/receipts do not
transfer request state back from RS after acknowledgment.

An authenticated machine `ngs_request_queue_list` success can include the
optional HTTP response header `X-NGS-Commit-Sha`. The Mac launch selector
sets `NGS_COMMIT_SHA` only from the verified immutable release. If no full
lowercase canonical Git SHA is supplied, the header is omitted. The JSON-RPC
envelope, queue contents, and other tools are unchanged.

NPC full replacement keeps the exact published roster ID, including enrolled
legacy `character.*` IDs. Its canonical slug remains tied to that ID. Local
and Space both require the exact target before queuing a replacement; new
creation uses the `npc.*` namespace only. The movement picker accepts any
nonempty selection of different, currently published presets, subject to
the existing transport payload size. The two default buttons only edit the
visible selection.
