-- Migration: Add accommodation_selections table
-- Date: 2025-08-05
-- Description: Create table to store guest's selected accommodation nights

-- Create accommodation_selections table
CREATE TABLE IF NOT EXISTS accommodation_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID REFERENCES guest_invitations(id) ON DELETE CASCADE,
  selected_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(invitation_id, selected_date)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_accommodation_selections_invitation_id 
  ON accommodation_selections(invitation_id);

-- Add comment explaining the table
COMMENT ON TABLE accommodation_selections IS 'Stores which specific nights a guest has selected for accommodation after confirming their invitation';
COMMENT ON COLUMN accommodation_selections.invitation_id IS 'Reference to the guest invitation';
COMMENT ON COLUMN accommodation_selections.selected_date IS 'The date for which accommodation is requested';