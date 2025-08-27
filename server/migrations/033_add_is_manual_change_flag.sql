-- Migration: Add is_manual_change flag to guest_invitations table
-- Purpose: Track invitations where status was manually changed by admin
-- Date: 2025-08-24

-- Add is_manual_change column to track manual status changes
ALTER TABLE guest_invitations 
ADD COLUMN IF NOT EXISTS is_manual_change BOOLEAN DEFAULT FALSE;

-- Add index for performance when filtering manual changes
CREATE INDEX IF NOT EXISTS idx_guest_invitations_manual_change 
ON guest_invitations(is_manual_change) 
WHERE is_manual_change = true;

-- Add comment for documentation
COMMENT ON COLUMN guest_invitations.is_manual_change IS 'True if invitation status was manually changed by admin';