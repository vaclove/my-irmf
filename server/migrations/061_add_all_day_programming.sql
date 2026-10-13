-- Migration: all-day programme entries
-- An entry without a time is an all-day event (exhibition, VR zone, ...).
-- It may run over several days: scheduled_date is the first day, end_date the
-- last one (NULL = a single day). Only all-day entries can span days; a timed
-- event repeated on several days is still one entry per screening.
--
-- The public site lists all-day events at the bottom of every day they cover.
-- Overlap checks ignore them, and the double-booking UNIQUE(venue_id,
-- scheduled_date, scheduled_time) does not apply to them (NULLs are distinct).

ALTER TABLE programming_schedule
  ALTER COLUMN scheduled_time DROP NOT NULL;

ALTER TABLE programming_schedule
  ADD COLUMN IF NOT EXISTS end_date DATE;

ALTER TABLE programming_schedule
  ADD CONSTRAINT chk_programming_end_date CHECK (
    end_date IS NULL OR (scheduled_time IS NULL AND end_date > scheduled_date)
  );

COMMENT ON COLUMN programming_schedule.scheduled_time IS 'Start time; NULL = all-day event';
COMMENT ON COLUMN programming_schedule.end_date IS 'Last day of a multi-day all-day event (NULL = single day)';
