-- Add GoOut integration fields to programming_schedule table

-- Add GoOut schedule ID (the specific screening instance in GoOut)
ALTER TABLE programming_schedule
ADD COLUMN goout_schedule_id VARCHAR(50);

-- Add GoOut check-in ID (required for ticket validation in scanner)
ALTER TABLE programming_schedule
ADD COLUMN goout_checkin_id VARCHAR(50);

-- Create index for quick lookup by GoOut schedule ID
CREATE INDEX idx_programming_schedule_goout_schedule_id
ON programming_schedule(goout_schedule_id)
WHERE goout_schedule_id IS NOT NULL;

-- Create index for quick lookup by GoOut check-in ID
CREATE INDEX idx_programming_schedule_goout_checkin_id
ON programming_schedule(goout_checkin_id)
WHERE goout_checkin_id IS NOT NULL;