CREATE TABLE IF NOT EXISTS ngs_ephemeral_project_catalog_v1 (
  actor_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  expiry INTEGER NOT NULL,
  result TEXT
);
