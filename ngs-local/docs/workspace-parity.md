# Workspace request parity

Local NGS, Space, and the local Viewer are deployment targets of the same production workspace. For a feature shipped with its adapters, apply the same UI, role eligibility, input contract, reference and revision checks, and official workflow. Whether a caller is Local or hosted is not a feature policy.

Keep differences at transport boundaries:
- Local uses its authenticated local intake. Space uses the authenticated Binari roster and the existing CSRF-checked browser intake. Viewer uses the same authenticated Space intake via Codex MCP; the local Viewer must not invent its own write grant or persist a request for replay.
- Space queue entries are transport tickets, not official receipts. The Request Service must re-fetch the ticket through its configured trusted Space reader before applying the same typed contract and PDS readiness checks as Local.
- The Viewer reads its verified local P2 snapshot. Filex remains authoritative for mutations. Local and hosted asset replication, deployment sequencing, and auth credentials are not interchangeable.
- A capability that needs a live service or an asset should use the same readiness predicate with an adapter for that environment. Never add `!hosted` to a production action or weaken project/CSRF/target checks to make a button appear.

## Current rollout candidate

- The three surfaces reuse the common workspace UI. Background source+pixel and ambient loop requests use the same existing payload/admission and actual PDS reference check. A 60-second BGM request uses the same typed contract. Map and assembly validation is shared for create and update, and delete roots/expected pins use the same classifier. Existing ready paths remain governed by the exact authenticated project and typed target.
- Land and validate the Request Service and RS relay first, then the compatible Local, Space and team Viewer bundles. The MCP session negotiates the expanded background capabilities; older Viewers retain their compatible session shape until updated. Keep existing privileges intact. Use fixtures for create, update, delete, stale-reference rejection and unauthorized rejection; do not submit live creation or deletion for smoke testing.
- Remaining work before claiming full parity: expose a safe canonical inventory for whole cinematic source deletion (the Local path asks PDS; a stale replica must not stand in for that authority); package the C# puzzle runtime for the two other targets before accepting proof-required assembly creation there; verify dedicated NPC portrait regeneration end to end against the actual Request Service/worker before exposing its control. The standalone Local puzzle showcase has its own asset-serving path and is not a formal CRUD permission.
