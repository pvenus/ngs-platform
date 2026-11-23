# Published BGM library index

Local Miniflare and Space share the same replica projection. The album page
does not enumerate object keys or read per-track objects. Only the direct,
hash-pinned playback route opens the selected WAV.

- `GET /api/audio-workspace?projectId=binari[&cursor=...]` returns
  `{projectId,results,nextCursor}`. At most 30 results, newest canonical
  `generatedAt` first; ties sort by official request ID descending. Unknown
  historical dates sort last. The cursor is a strict keyset position, not a
  snapshot. Additions ahead of that position appear on a fresh first page.
- `GET /api/audio-workspace?projectId=binari&resultId=...` returns
  `{projectId,result}`, with exact `null` only if that published pair is
  absent. Absence from a playlist page is not evidence of deletion.
- `GET ...&id=...&sha256=...` remains the existing range-capable playback
  route and rechecks the current published proof.

Migration `0016_audio_result_index.sql` adds only two derived tables and one
partial ordering index. It does not change existing version rows or bytes.
The successful replica version CAS updates the projection in the same
transaction for standard chunks, whole-file receive, and tombstones. Both the
validated metadata and matching published WAV size/digest must be present.

Historical results are reconstructed by ordinary authenticated machine sync:
each begin reuses its existing file inventory and indexes at most 12 historical
metadata rows, in ID order. No page load does a backfill. Until the first
successful sweep, list and exact JSON lookups return 503 (not a false empty
library); direct playback continues. Confirm a successful complete index
sweep before switching the browser playlist to keyset mode. After a one-time
sweep, sync no longer opens any audio object for index reconstruction.

Stop old writers before activating the new projection. Local's Miniflare
startup pin upgrades only the exact preceding schema. For rollback to a
pre-index Local binary, a coordinated stop and reviewed rollback of the two
derived index tables and corresponding schema pin is needed; do not fall
back to an old writer on an indexed running store. Space D1 leaves its
additive schema on code rollback; re-run a bounded backfill before reactivating
the projection if an old writer synchronized while it was inactive.
