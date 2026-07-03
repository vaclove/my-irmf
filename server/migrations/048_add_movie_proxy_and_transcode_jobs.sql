-- Migration: preview proxy file kind + transcode jobs
-- Adds a 'movie_proxy' file kind (the web-playable 720p H.264/AAC MP4 generated
-- from the master) and a table of background transcode jobs processed by an
-- out-of-process worker (Azure Container Apps Job) triggered via a storage queue.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

-- 1. Extend movie_files.file_kind CHECK -----------------------------------------
-- 047 created the constraint inline (auto-named). Drop whatever CHECK on this
-- table mentions file_kind, then re-add an explicitly named one that also
-- allows 'movie_proxy'.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'movie_files'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%file_kind%'
  LOOP
    EXECUTE format('ALTER TABLE movie_files DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE movie_files ADD CONSTRAINT movie_files_file_kind_check
  CHECK (file_kind IN ('movie', 'movie_proxy', 'subtitles_cs', 'subtitles_en'));

-- 2. Transcode jobs ------------------------------------------------------------
-- One row per generation request. An out-of-process worker picks the job up from
-- a storage queue keyed on this id, streams the master from Drive, transcodes,
-- uploads the proxy back, and updates progress here. No 'interrupted' status:
-- a crashed run's queue message reappears and the worker restarts from scratch.
CREATE TABLE IF NOT EXISTS movie_transcode_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  source_drive_file_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  phase TEXT CHECK (phase IN ('probing', 'transcoding', 'uploading')),
  duration_seconds NUMERIC,
  progress_percent NUMERIC NOT NULL DEFAULT 0,
  bytes_total BIGINT,
  bytes_transferred BIGINT NOT NULL DEFAULT 0,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  attempt_count INT NOT NULL DEFAULT 0,
  target_file_name TEXT,
  drive_file_id TEXT,
  error_message TEXT,
  created_by TEXT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_movie_transcode_jobs_movie_id ON movie_transcode_jobs(movie_id);
CREATE INDEX IF NOT EXISTS idx_movie_transcode_jobs_status ON movie_transcode_jobs(status);

-- 3. updated_at trigger (same pattern as 047) ----------------------------------
CREATE OR REPLACE FUNCTION update_movie_transcode_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS movie_transcode_jobs_updated_at_trigger ON movie_transcode_jobs;
CREATE TRIGGER movie_transcode_jobs_updated_at_trigger
  BEFORE UPDATE ON movie_transcode_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_movie_transcode_jobs_updated_at();
