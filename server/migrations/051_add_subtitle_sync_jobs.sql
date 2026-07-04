-- Migration: synced subtitle file kinds + subtitle sync jobs
-- Adds 'subtitles_cs_synced'/'subtitles_en_synced' file kinds (subtitle copies
-- re-timed to the movie's audio with alass) and a table of background sync jobs
-- processed by the transcode worker (Azure Container Apps Job) via the same
-- storage queue, discriminated by a message `type` field.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

-- 1. Extend movie_files.file_kind CHECK -----------------------------------------
-- Same pattern as 048: drop whatever CHECK mentions file_kind, re-add a named one.
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
  CHECK (file_kind IN ('movie', 'movie_proxy', 'subtitles_cs', 'subtitles_en',
                       'subtitles_cs_synced', 'subtitles_en_synced'));

-- 2. Subtitle sync jobs ---------------------------------------------------------
-- One row per sync request. The worker extracts audio from the reference video
-- (proxy preferred, master fallback), aligns the subtitle with alass, uploads the
-- synced SRT as a new Drive file, and updates progress here. No 'interrupted'
-- status: a crashed run's queue message reappears and the worker restarts.
CREATE TABLE IF NOT EXISTS subtitle_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  subtitle_kind TEXT NOT NULL CHECK (subtitle_kind IN ('subtitles_cs', 'subtitles_en')),
  source_drive_file_id TEXT NOT NULL,
  reference_drive_file_id TEXT NOT NULL,
  reference_kind TEXT NOT NULL CHECK (reference_kind IN ('movie_proxy', 'movie')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  phase TEXT CHECK (phase IN ('probing', 'extracting_audio', 'aligning', 'uploading')),
  duration_seconds NUMERIC,
  progress_percent NUMERIC NOT NULL DEFAULT 0,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  attempt_count INT NOT NULL DEFAULT 0,
  target_file_name TEXT,
  drive_file_id TEXT,
  error_message TEXT,
  created_by TEXT,
  dismissed_at TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subtitle_sync_jobs_movie_id ON subtitle_sync_jobs(movie_id);
CREATE INDEX IF NOT EXISTS idx_subtitle_sync_jobs_status ON subtitle_sync_jobs(status);
-- CS and EN tracks sync independently; one active job per movie+track.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subtitle_sync_jobs_one_active_per_track
  ON subtitle_sync_jobs(movie_id, subtitle_kind)
  WHERE status IN ('pending', 'running');

-- 3. updated_at trigger (same pattern as 048) ----------------------------------
CREATE OR REPLACE FUNCTION update_subtitle_sync_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subtitle_sync_jobs_updated_at_trigger ON subtitle_sync_jobs;
CREATE TRIGGER subtitle_sync_jobs_updated_at_trigger
  BEFORE UPDATE ON subtitle_sync_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_subtitle_sync_jobs_updated_at();
