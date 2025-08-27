-- Add changed_by field to track who made manual status changes
ALTER TABLE guest_invitations
ADD COLUMN IF NOT EXISTS changed_by VARCHAR(255);

-- Add index for changed_by field
CREATE INDEX IF NOT EXISTS idx_guest_invitations_changed_by
ON guest_invitations(changed_by)
WHERE changed_by IS NOT NULL;

-- Add comment explaining the field
COMMENT ON COLUMN guest_invitations.changed_by IS 'Email of the user who made the last manual status change';