-- Migration: output resolution of a burned-in subtitle export
-- resolution: 'auto' renders 1080p, or 2160p for UHD masters (the behaviour
-- before this column); '1080p' forces HD even from a 4K master — a faster
-- render and a smaller file.

ALTER TABLE subtitle_burn_jobs ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT 'auto'
  CHECK (resolution IN ('auto', '1080p'));
