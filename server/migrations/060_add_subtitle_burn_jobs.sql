-- Migration: burned-in subtitle exports
-- A job renders a copy of the movie master with Czech and/or English
-- subtitles burned into the picture, for screening from a laptop. The movie
-- worker (Azure Container Apps Job) does the work, picked up from the shared
-- storage queue as {job_id, type: 'subtitle_burn'}.
--
--   kind 'preview'  ~60 s clip around the densest subtitles, to check the look
--   kind 'full'     the whole movie
--
-- Results are temporary downloads, not movie files: they go to the private
-- 'exports' container of the movie storage account and a lifecycle rule
-- deletes them (full after 20 days, previews after 3). expires_at mirrors
-- that so the app never offers a link to a deleted blob; blob_deleted_at is
-- set when the app deletes one itself (replaced by a newer export, or removed
-- by hand).
--
-- Subtitle refs are file refs as in the other job tables ('blob:<name>' or a
-- Drive file id); NULL means the language is not burned in.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

CREATE TABLE IF NOT EXISTS subtitle_burn_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('preview', 'full')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  phase TEXT CHECK (phase IN ('probing', 'rendering', 'verifying', 'uploading')),
  source_ref TEXT NOT NULL,
  subtitle_cs_kind TEXT CHECK (subtitle_cs_kind IN ('subtitles_cs', 'subtitles_cs_synced')),
  subtitle_cs_ref TEXT,
  subtitle_en_kind TEXT CHECK (subtitle_en_kind IN ('subtitles_en', 'subtitles_en_synced')),
  subtitle_en_ref TEXT,
  -- Preview only: requested start (NULL = densest subtitles) and length.
  preview_start_seconds NUMERIC,
  preview_length_seconds NUMERIC,
  -- What the worker decided: canvas, picture placement, crop, subtitle layout.
  render_info JSONB,
  duration_seconds NUMERIC,
  progress_percent NUMERIC NOT NULL DEFAULT 0,
  bytes_transferred BIGINT NOT NULL DEFAULT 0,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  attempt_count INT NOT NULL DEFAULT 0,
  blob_name TEXT,
  file_name TEXT,
  file_size BIGINT,
  expires_at TIMESTAMP,
  blob_deleted_at TIMESTAMP,
  error_message TEXT,
  created_by TEXT,
  dismissed_at TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT subtitle_burn_jobs_has_subtitles
    CHECK (subtitle_cs_ref IS NOT NULL OR subtitle_en_ref IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_subtitle_burn_jobs_movie_id ON subtitle_burn_jobs(movie_id);
-- One active preview and one active full export per movie.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subtitle_burn_jobs_one_active
  ON subtitle_burn_jobs(movie_id, kind)
  WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION update_subtitle_burn_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subtitle_burn_jobs_updated_at_trigger ON subtitle_burn_jobs;
CREATE TRIGGER subtitle_burn_jobs_updated_at_trigger
  BEFORE UPDATE ON subtitle_burn_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_subtitle_burn_jobs_updated_at();
