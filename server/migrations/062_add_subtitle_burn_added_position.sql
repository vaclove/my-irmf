-- Migration: subtitles added to a master that already has some burned in
-- existing_subtitles_lang: the language already burned into the master's
--   picture (NULL = none). The export then burns in only the other language,
--   in the second (yellow) colour, and leaves the picture uncropped and
--   centered so the position chosen in the app matches the render.
-- added_position: bottom edge of the added subtitles as a fraction of the
--   export canvas height (0 = top, 1 = bottom), chosen against the movie's
--   preview in the app.

ALTER TABLE subtitle_burn_jobs ADD COLUMN IF NOT EXISTS existing_subtitles_lang TEXT
  CHECK (existing_subtitles_lang IN ('cs', 'en'));
ALTER TABLE subtitle_burn_jobs ADD COLUMN IF NOT EXISTS added_position NUMERIC
  CHECK (added_position > 0 AND added_position <= 1);
ALTER TABLE subtitle_burn_jobs DROP CONSTRAINT IF EXISTS subtitle_burn_jobs_added_position_check;
ALTER TABLE subtitle_burn_jobs ADD CONSTRAINT subtitle_burn_jobs_added_position_check
  CHECK (existing_subtitles_lang IS NULL OR added_position IS NOT NULL);
