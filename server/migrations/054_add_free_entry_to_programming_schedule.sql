-- Add free_entry flag to programming_schedule table
-- Marks screenings/events with free admission (e.g. discussions, podcasts)

ALTER TABLE programming_schedule
ADD COLUMN IF NOT EXISTS free_entry BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN programming_schedule.free_entry IS 'Admission to this screening/event is free';
