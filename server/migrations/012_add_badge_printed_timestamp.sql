-- Migration: 012_add_badge_printed_timestamp.sql
-- Description: Add badge_printed_at timestamp to track when badges are printed
-- Date: 2025-07-20

-- Add badge_printed_at column to guest_invitations table
ALTER TABLE guest_invitations 
ADD COLUMN badge_printed_at TIMESTAMP;

-- Add badge_printed_at column to guest_editions table (for confirmed guests)
ALTER TABLE guest_editions 
ADD COLUMN badge_printed_at TIMESTAMP;

-- Create index for badge printed tracking
CREATE INDEX idx_guest_invitations_badge_printed_at ON guest_invitations(badge_printed_at);
CREATE INDEX idx_guest_editions_badge_printed_at ON guest_editions(badge_printed_at);