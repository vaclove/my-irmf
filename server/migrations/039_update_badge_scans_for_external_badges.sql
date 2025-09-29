-- Allow external badges in badge_scans table
-- Make guest_id nullable and change badge_number to support external badge codes

-- Make guest_id nullable (for external badges without guest records)
ALTER TABLE badge_scans
ALTER COLUMN guest_id DROP NOT NULL;

-- Change badge_number from integer to varchar to support external badge codes
ALTER TABLE badge_scans
ALTER COLUMN badge_number TYPE VARCHAR(50);

-- Update the unique constraint to work with nullable guest_id
-- Drop the old constraint
ALTER TABLE badge_scans
DROP CONSTRAINT IF EXISTS badge_scans_programming_id_guest_id_key;

-- Add a new partial unique constraint that only applies when guest_id is not null
CREATE UNIQUE INDEX badge_scans_programming_guest_unique
ON badge_scans (programming_id, guest_id)
WHERE guest_id IS NOT NULL;

-- Add a unique constraint for external badges (programming_id + badge_number when guest_id is null)
CREATE UNIQUE INDEX badge_scans_programming_external_unique
ON badge_scans (programming_id, badge_number)
WHERE guest_id IS NULL;