-- Add highlighted field to programming_schedule table
ALTER TABLE programming_schedule
ADD COLUMN highlighted BOOLEAN DEFAULT FALSE;

-- Add index for filtering highlighted screenings
CREATE INDEX idx_programming_schedule_highlighted ON programming_schedule(highlighted);
