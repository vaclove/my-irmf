-- Migration: allow hiding finished subtitle translation jobs from the UI
-- Adds dismissed_at so a user can dismiss a terminal (completed/failed/
-- cancelled/interrupted) job. Dismissed jobs are filtered out of the movie
-- job list the client polls. Active jobs cannot be dismissed.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

ALTER TABLE subtitle_translation_jobs
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP;
