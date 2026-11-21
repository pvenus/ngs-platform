# Instance MCP flows: local first

The original Request Service and Project Data Service are unchanged. The NGS
browser uses its own NGS instance and does not connect to either one directly.
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

## File synchronization (next phase; no code or rollout in this phase)

- pds-mcp is the sender. It walks the PDS canonical folders project by project
  and sends only changed files to the destination's NGS MCP. Both NGS instances
  are receivers and own their local files, hash inventories, and receipt decisions.
- Each instance refreshes its full hash inventory periodically; on a verified
  inbound write it updates the affected entry immediately. The manifest includes
  its update time and a revision so two cycles do not rely only on synchronized
  wall clocks. Bytes are verified against the advertised digest before commit.
- On receive, recheck the current file: if the hash already matches, acknowledge
  success and refresh the local hash record without rewriting the bytes. If it
  differs, commit the verified file before acknowledging the new hash.
- Serialize compare and transfer for each destination instance. While that
  instance is receiving files do not start another comparison. If a pass
  is shorter than one minute, wait until at least one minute from its start;
  if longer, begin the next check only after it finishes. One slow instance
  does not gate another one. No old data migration or public connection is assumed.
