-- Migration: top or bottom anchoring of subtitles added to burned-in ones
-- added_align: whether added_position is the top edge ('top', the block
-- grows downwards — English goes to the top by default) or the bottom edge
-- ('bottom', the block grows upwards) of the added subtitles. Rows from
-- before this column were bottom-anchored.

ALTER TABLE subtitle_burn_jobs ADD COLUMN IF NOT EXISTS added_align TEXT NOT NULL DEFAULT 'bottom'
  CHECK (added_align IN ('top', 'bottom'));
