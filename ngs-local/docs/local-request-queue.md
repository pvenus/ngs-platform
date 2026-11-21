# Local NGS request handoff

NGS queues a validated submission in a local SQLite spool. Queuing is not RS
registration. Only the local RS consumer calls the MCP list/ack tools. It must
acknowledge only a successful, exact official receipt it obtained from RS,
never an inferred ID, rejected registration, or transport failure. The queue
also checks the receipt ID against the pending entry's original RS identity.
An unconfirmed entry stays pending across service restarts; there is no expiry
or automatic deletion of pending entries. The browser receipt is a 15-minute
handoff, not request history. Replaying a client key is deduplicated while
its queue entry or handoff receipt is still retained.

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
