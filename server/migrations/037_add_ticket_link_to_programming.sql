-- Migration: Add ticket_link field to programming_schedule table
-- This migration adds a ticket_link field for direct links to ticket presale

ALTER TABLE programming_schedule
ADD COLUMN ticket_link VARCHAR(500);

-- Add comment to the column
COMMENT ON COLUMN programming_schedule.ticket_link IS 'Direct link to ticket presale for this screening';

-- Create index for ticket_link queries (for filtering/searching)
CREATE INDEX idx_programming_ticket_link ON programming_schedule(ticket_link) WHERE ticket_link IS NOT NULL;