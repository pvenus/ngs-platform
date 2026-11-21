# Instance MCP flows: local first

The original Request Service and Project Data Service are unchanged. The NGS
browser uses its own NGS instance and does not connect to either one directly.
The independent rs-mcp and pds-mcp watch processes send their own heartbeat
to OPS every 60 seconds. The NGS browser does not send a separate heartbeat.
On the Mac, 5274 is the NGS browser service, 5275 is the NGS local queue MCP,
and 8770 remains the existing RS MCP. These are loopback-only endpoints.

## Request handoff (implemented and verified on isolated local fixtures)

1. NGS validates the existing request shape and enqueues it durably. HTTP 202
   means local submission succeeded. The form does not wait for RS.
2. The independent rs-mcp consumer polls, calls the unchanged RS submit tool
   using a single immutable idempotency key, and sends NGS the exact verified
   official receipt. Other work may proceed when a single request cannot be
   verified.
3. Only after the receipt matches does NGS clear the request payload and
   remove it from the pending list. The authenticated browser lists pending
   request types and enqueue times from SQLite; it does not query RS. A short
   internal dedup marker is not exposed as history. RS keeps official history. An ambiguous result stays queued for
   reconciliation; neither transport loss nor a duplicate conflict is
   evidence that the request was safely persisted.

The first handoff receipt means RS persisted the request, not that content
generation is complete. Space is intentionally not part of the first rollout.

## File synchronization (local NGS push)

- pds-mcp is the sender. It walks the PDS canonical folders project by project
  and sends only changed files to the destination's NGS MCP. Both NGS instances
  are receivers and own their local files, hash inventories, and receipt decisions.
- NGS refreshes the full project hash inventory at the start of that project’s
  periodic pass. On a verified write or identical-file acknowledgment it updates
  the affected entry immediately. The inventory includes its observation time;
  the active cycle ID and digest checks, not clock comparison, protect writes.
- On receive, recheck the current file: if the hash already matches, acknowledge
  success and refresh the local hash record without rewriting the bytes. If it
  differs, commit the verified file before acknowledging the new hash.
- Serialize compare and transfer for each destination instance. While that
  instance is receiving files do not start another comparison. If a pass
  is shorter than one minute, wait until at least one minute from its start;
  if longer, begin the next check only after it finishes. One slow instance
  does not gate another one. No old data migration or public connection is assumed.

The staged sender uses existing PDS tool contracts; the PDS and RS release
artifacts are unchanged. For a local development run, keep NGS and PDS MCP
listeners on IPv4 loopback and use an isolated replica:

```sh
PDS_MCP_URL=http://127.0.0.1:18030/mcp \
NGS_FILE_SYNC_MCP_URL=http://127.0.0.1:15275/mcp \
NGS_FILE_SYNC_PROJECTS=binari \
node ngs-local/sites/npcgen/build/pds-mcp-file-sync.mjs --watch
```

Set `NGS_FILE_SYNC_MODE=push` and `NGS_FILE_SYNC_PROJECTS=binari` for the
receiver, and give the browser and receiver the same
`NGS_PROJECT_CATALOG_ROOT` (an existing private replica). Use a separate
fixture queue DB and `NGS_REQUEST_QUEUE_MCP_PORT=15275` when testing the receiver.
The browser reads only that replica and has no PDS pull mode or official RS
client. Legacy browser compare routes return no work and refresh/write routes
reject. Publishing is atomic per file, not per project.
For an active project, remove a stale replica file only when PDS explicitly
reports it absent and reconfirms the exact path and prior replica hash. NGS
then checks that its current file still has that hash and moves it out of the
visible tree to the existing recoverable `.deleted-sync` area; it never
permanently deletes a file or mutates a PDS source path. An unavailable or
undiscovered project is not an instruction to remove it. Dot directories,
including nested `.deleted`, never participate. Local testing does not
enable the Space transport.
