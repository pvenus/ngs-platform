CREATE TABLE `ngs_space_file_replica_sync_v1` (
  `slot` integer PRIMARY KEY NOT NULL CHECK (`slot` = 1),
  `sync_id` text NOT NULL,
  `expiry` integer NOT NULL,
  `lock_id` text,
  `written` integer NOT NULL,
  `file_count` integer NOT NULL,
  `upload` text,
  `last` text
);
