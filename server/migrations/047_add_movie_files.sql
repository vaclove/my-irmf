-- Migration: Add movie files Google Shared Drive integration
-- Adds a per-movie Drive folder pointer, a table of classified Drive file pointers
-- (movie file + CZ/EN subtitles), and a table of background download jobs.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

-- 1. Per-movie Drive folder pointer -------------------------------------------
ALTER TABLE movies ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;

-- 2. Classified Drive file pointers -------------------------------------------
-- One row per (movie, kind). Lets the movies list render 3-asset status with no
-- Drive API calls. file_kind is TEXT + CHECK (not a PG enum) for easy evolution.
CREATE TABLE IF NOT EXISTS movie_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  file_kind TEXT NOT NULL CHECK (file_kind IN ('movie', 'subtitles_cs', 'subtitles_en')),
  drive_file_id TEXT NOT NULL,
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT,
  md5_checksum TEXT,
  drive_modified_at TIMESTAMP,
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (movie_id, file_kind)
);

CREATE INDEX IF NOT EXISTS idx_movie_files_movie_id ON movie_files(movie_id);

-- 3. Background download jobs --------------------------------------------------
-- Server-side downloader (public Drive link or FTP) streams source -> Drive.
CREATE TABLE IF NOT EXISTS movie_download_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  file_kind TEXT NOT NULL CHECK (file_kind IN ('movie', 'subtitles_cs', 'subtitles_en')),
  source_type TEXT NOT NULL CHECK (source_type IN ('gdrive', 'ftp')),
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  bytes_total BIGINT,
  bytes_transferred BIGINT NOT NULL DEFAULT 0,
  target_file_name TEXT,
  drive_file_id TEXT,
  error_message TEXT,
  created_by TEXT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_movie_download_jobs_movie_id ON movie_download_jobs(movie_id);
CREATE INDEX IF NOT EXISTS idx_movie_download_jobs_status ON movie_download_jobs(status);

-- 4. updated_at triggers (same pattern as 013_create_movies_table.sql) ---------
CREATE OR REPLACE FUNCTION update_movie_files_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS movie_files_updated_at_trigger ON movie_files;
CREATE TRIGGER movie_files_updated_at_trigger
  BEFORE UPDATE ON movie_files
  FOR EACH ROW
  EXECUTE FUNCTION update_movie_files_updated_at();

CREATE OR REPLACE FUNCTION update_movie_download_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS movie_download_jobs_updated_at_trigger ON movie_download_jobs;
CREATE TRIGGER movie_download_jobs_updated_at_trigger
  BEFORE UPDATE ON movie_download_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_movie_download_jobs_updated_at();
