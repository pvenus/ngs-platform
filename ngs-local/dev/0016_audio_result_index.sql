CREATE TABLE ngs_audio_result_index_v1 (
 id TEXT PRIMARY KEY NOT NULL, metadata_version INTEGER NOT NULL DEFAULT -1, wav_version INTEGER NOT NULL DEFAULT -1,
 generated_at INTEGER, title TEXT, bpm INTEGER, separated INTEGER, duration_seconds REAL,
 metadata_audio_sha TEXT, metadata_audio_size INTEGER, wav_sha TEXT, wav_size INTEGER
);
--> statement-breakpoint
CREATE INDEX ngs_audio_result_index_v1_newest ON ngs_audio_result_index_v1(generated_at DESC,id DESC)
 WHERE title IS NOT NULL AND metadata_audio_sha=wav_sha AND metadata_audio_size=wav_size;
--> statement-breakpoint
CREATE TABLE ngs_audio_result_index_progress_v1 (id INTEGER PRIMARY KEY CHECK(id=1), last_id TEXT NOT NULL, complete INTEGER NOT NULL CHECK(complete IN (0,1)));
