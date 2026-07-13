-- Migration: subtitle quality gate
-- Quality runs lint a movie's subtitle file (automatically after every
-- translation job, or on demand) and store per-cue flags with optional
-- LLM-proposed fixes the editor can accept or dismiss. Also adds the
-- translation brief (text + machine-readable JSON) to translation jobs so
-- the gate can check glossary/register consistency.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

ALTER TABLE subtitle_translation_jobs ADD COLUMN IF NOT EXISTS brief TEXT;
ALTER TABLE subtitle_translation_jobs ADD COLUMN IF NOT EXISTS brief_json JSONB;

-- One row per quality-gate run over one subtitle file (job-like: the client
-- polls status/phase/counters here). 'interrupted' covers server restarts.
CREATE TABLE IF NOT EXISTS subtitle_quality_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  lang TEXT NOT NULL CHECK (lang IN ('cs', 'en', 'cs_synced', 'en_synced')),
  file_drive_id TEXT NOT NULL,
  file_md5 TEXT,
  translation_job_id UUID REFERENCES subtitle_translation_jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  phase TEXT CHECK (phase IN ('linting', 'suggesting')),
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  total_cues INT,
  flag_count INT,
  error_count INT,
  warn_count INT,
  info_count INT,
  suggest_total INT,
  suggest_done INT NOT NULL DEFAULT 0,
  -- Whether the counterpart-language file existed and its cue count matched;
  -- reference-comparative checks only ran when both are true.
  ref_available BOOLEAN,
  ref_cue_count_match BOOLEAN,
  error_message TEXT,
  created_by TEXT,
  dismissed_at TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subtitle_quality_runs_movie
  ON subtitle_quality_runs(movie_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subtitle_quality_runs_one_active
  ON subtitle_quality_runs(movie_id, lang)
  WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION update_subtitle_quality_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subtitle_quality_runs_updated_at_trigger ON subtitle_quality_runs;
CREATE TRIGGER subtitle_quality_runs_updated_at_trigger
  BEFORE UPDATE ON subtitle_quality_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_subtitle_quality_runs_updated_at();

-- One row per (cue, check) finding. ref_text/target_text are snapshots taken
-- at lint time — the editor and the save handler compare against them to
-- detect drift (manual edits, replaced files) and mark flags stale. A cue
-- with several flags shares one suggestion, duplicated onto each row.
CREATE TABLE IF NOT EXISTS subtitle_quality_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES subtitle_quality_runs(id) ON DELETE CASCADE,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  lang TEXT NOT NULL CHECK (lang IN ('cs', 'en', 'cs_synced', 'en_synced')),
  file_drive_id TEXT NOT NULL,
  file_md5 TEXT,
  cue_index INT NOT NULL,
  cue_n INT NOT NULL,
  cue_start_ms BIGINT,
  code TEXT NOT NULL CHECK (code IN ('TAG', 'FMT', 'CPS', 'REG', 'GLOS', 'UNTR', 'LEN', 'NUM')),
  severity TEXT NOT NULL CHECK (severity IN ('error', 'warn', 'info')),
  message TEXT NOT NULL,
  ref_text TEXT,
  target_text TEXT NOT NULL,
  suggestion TEXT,
  suggestion_verified BOOLEAN,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'dismissed', 'stale')),
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subtitle_quality_flags_open
  ON subtitle_quality_flags(movie_id, lang)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_subtitle_quality_flags_run
  ON subtitle_quality_flags(run_id);

CREATE OR REPLACE FUNCTION update_subtitle_quality_flags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subtitle_quality_flags_updated_at_trigger ON subtitle_quality_flags;
CREATE TRIGGER subtitle_quality_flags_updated_at_trigger
  BEFORE UPDATE ON subtitle_quality_flags
  FOR EACH ROW
  EXECUTE FUNCTION update_subtitle_quality_flags_updated_at();
