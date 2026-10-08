-- Migration: subtitle file cache
-- Decoded text of subtitle files, keyed by Drive file id + the md5 of the
-- bytes it was decoded from. Reads (player tracks, editor, translation,
-- quality checks, sync) are served from here while the md5 still matches the
-- movie_files row, so Drive download quota/outages don't break them; when
-- Drive refuses a download the last cached copy is served as a fallback.
-- Writes refresh the entry. No FK: rows for trashed files are harmless.

CREATE TABLE IF NOT EXISTS subtitle_file_cache (
  drive_file_id TEXT PRIMARY KEY,
  md5_checksum TEXT NOT NULL,
  content TEXT NOT NULL,
  byte_size INT NOT NULL,
  cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
