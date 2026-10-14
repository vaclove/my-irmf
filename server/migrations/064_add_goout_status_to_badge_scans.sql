-- Migration: record how a GoOut ticket scan was verified
-- checked_in  - ticket for this screening, checked in at GoOut
-- pass        - festival pass of this edition, checked in to this screening at GoOut
-- unverified  - GoOut did not answer in time (or the screening is not linked
--               to GoOut); let in and kept for review
-- NULL        - not a GoOut ticket, or scanned before verification existed
ALTER TABLE badge_scans
ADD COLUMN IF NOT EXISTS goout_status VARCHAR(20);
