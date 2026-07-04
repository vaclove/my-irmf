-- Migration: LLM subtitle translation jobs
-- One row per request to machine-translate a movie's subtitles between Czech
-- and English (movie_files kinds subtitles_cs <-> subtitles_en). Jobs run
-- in-process in the Express app (like movie_download_jobs); the client polls
-- progress here. Includes 'interrupted' for jobs orphaned by a restart.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

CREATE TABLE IF NOT EXISTS subtitle_translation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('cs_to_en', 'en_to_cs')),
  source_drive_file_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  model TEXT,
  total_cues INT,
  translated_cues INT NOT NULL DEFAULT 0,
  batch_count INT,
  batches_done INT NOT NULL DEFAULT 0,
  progress_percent NUMERIC NOT NULL DEFAULT 0,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  target_file_name TEXT,
  drive_file_id TEXT,
  error_message TEXT,
  created_by TEXT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subtitle_translation_jobs_movie_id
  ON subtitle_translation_jobs(movie_id);
CREATE INDEX IF NOT EXISTS idx_subtitle_translation_jobs_status
  ON subtitle_translation_jobs(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subtitle_translation_jobs_one_active_per_movie
  ON subtitle_translation_jobs(movie_id)
  WHERE status IN ('pending', 'running');

-- updated_at trigger (same pattern as 048)
CREATE OR REPLACE FUNCTION update_subtitle_translation_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subtitle_translation_jobs_updated_at_trigger ON subtitle_translation_jobs;
CREATE TRIGGER subtitle_translation_jobs_updated_at_trigger
  BEFORE UPDATE ON subtitle_translation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_subtitle_translation_jobs_updated_at();
