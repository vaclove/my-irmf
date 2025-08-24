-- Migration: Add manual_invitation flag to guest_invitations table
-- Purpose: Track invitations that were marked as invited without sending an email
-- Date: 2025-01-24

-- Add manual_invitation column to track invitations marked without email
ALTER TABLE guest_invitations 
ADD COLUMN IF NOT EXISTS manual_invitation BOOLEAN DEFAULT FALSE;

-- Add index for performance when filtering manual invitations
CREATE INDEX IF NOT EXISTS idx_guest_invitations_manual 
ON guest_invitations(manual_invitation) 
WHERE manual_invitation = true;

-- Add comment for documentation
COMMENT ON COLUMN guest_invitations.manual_invitation IS 'True if guest was marked as invited without sending an email';