CREATE TABLE ngs_replica_progress_v1 (
 sync_id TEXT PRIMARY KEY NOT NULL, total INTEGER NOT NULL,
 completed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'syncing'
);
--> statement-breakpoint
CREATE TABLE ngs_replica_progress_item_v1 (
 sync_id TEXT NOT NULL, path TEXT NOT NULL, state TEXT NOT NULL,
 PRIMARY KEY(sync_id,path)
);
--> statement-breakpoint
CREATE TRIGGER ngs_replica_progress_count_v1 AFTER INSERT ON ngs_replica_progress_item_v1 BEGIN
 UPDATE ngs_replica_progress_v1
 SET completed=completed+(NEW.state='completed'), failed=failed+(NEW.state='failed')
 WHERE sync_id=NEW.sync_id;
END;
