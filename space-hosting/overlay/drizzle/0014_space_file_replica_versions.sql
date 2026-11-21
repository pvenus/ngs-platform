CREATE TABLE ngs_replica_pass_v2 (sync_id TEXT PRIMARY KEY NOT NULL, baseline INTEGER NOT NULL, expiry INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE ngs_replica_receive_v2 (
 sync_id TEXT NOT NULL, path TEXT NOT NULL, attempt TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
 prior INTEGER NOT NULL, generation INTEGER NOT NULL, upload_id TEXT, received INTEGER NOT NULL, parts TEXT NOT NULL, last_sha TEXT, same INTEGER NOT NULL,
 PRIMARY KEY(sync_id,path)
);
--> statement-breakpoint
CREATE TABLE ngs_replica_version_v2 (
 version INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, sha256 TEXT NOT NULL,
 object_key TEXT, size INTEGER NOT NULL, sync_id TEXT NOT NULL, last_sha TEXT
);
--> statement-breakpoint
CREATE INDEX ngs_replica_version_v2_path ON ngs_replica_version_v2(path,version DESC);
--> statement-breakpoint
CREATE INDEX ngs_replica_version_v2_sync ON ngs_replica_version_v2(sync_id);
--> statement-breakpoint
CREATE UNIQUE INDEX ngs_replica_version_v2_object ON ngs_replica_version_v2(object_key);
--> statement-breakpoint
CREATE TABLE ngs_replica_reset_v2 (sync_id TEXT NOT NULL, path TEXT NOT NULL, generation INTEGER NOT NULL, PRIMARY KEY(sync_id,path));
