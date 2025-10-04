-- Add hidden_from_public column to programming_schedule table
-- This allows hiding screenings from the public schedule (e.g., private events, accreditation pickups)

ALTER TABLE programming_schedule
ADD COLUMN hidden_from_public BOOLEAN DEFAULT false;

-- Create index for quick filtering of public screenings
CREATE INDEX idx_programming_schedule_hidden_from_public
ON programming_schedule(hidden_from_public)
WHERE hidden_from_public = false;

-- Add comment
COMMENT ON COLUMN programming_schedule.hidden_from_public IS 'Hide this screening from public schedule view (but still visible in admin)';
