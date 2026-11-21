CREATE TABLE IF NOT EXISTS ngs_space_request_queue_v1 (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  client_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  request_type TEXT NOT NULL,
  payload TEXT,
  created_ms INTEGER NOT NULL,
  official_id TEXT,
  expires_ms INTEGER,
  UNIQUE(actor_id,client_key),
  CHECK ((official_id IS NULL AND expires_ms IS NULL AND payload IS NOT NULL)
    OR (official_id IS NOT NULL AND expires_ms IS NOT NULL AND payload IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ngs_space_request_queue_pending_v1
  ON ngs_space_request_queue_v1(seq) WHERE official_id IS NULL;
