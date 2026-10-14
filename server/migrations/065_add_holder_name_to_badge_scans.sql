-- Migration: name on a GoOut ticket, taken from the GoOut check-in response
-- so the scanner can show who came in. NULL when GoOut was not asked or did
-- not answer (unverified), and for our own badges (they link to guests).
ALTER TABLE badge_scans
ADD COLUMN IF NOT EXISTS holder_name VARCHAR(255);
