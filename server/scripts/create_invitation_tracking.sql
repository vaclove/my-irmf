-- Create invitation tracking table for tag-based assignments
-- This replaces the invitation tracking that was in guest_editions

-- Step 1: Create new invitation tracking table
CREATE TABLE IF NOT EXISTS guest_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP,
  confirmation_token VARCHAR(255),
  accommodation BOOLEAN DEFAULT FALSE,
  covered_nights INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guest_id, edition_id)
);

-- Step 2: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_guest_invitations_guest_id ON guest_invitations(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_invitations_edition_id ON guest_invitations(edition_id);
CREATE INDEX IF NOT EXISTS idx_guest_invitations_token ON guest_invitations(confirmation_token);

-- Step 3: Display table structure
\d guest_invitations;

-- Step 4: Show that table is empty (fresh start)
SELECT COUNT(*) as invitation_count FROM guest_invitations;