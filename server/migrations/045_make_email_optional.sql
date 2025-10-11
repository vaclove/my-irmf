-- Migration: Make email optional for guests
-- Date: 2025-10-11

-- Allow NULL values for email field
ALTER TABLE guests ALTER COLUMN email DROP NOT NULL;

-- Remove unique constraint on email if it exists (guests can have no email)
-- But keep the uniqueness for non-null emails
ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_email_key;

-- Add a unique constraint that only applies to non-null emails
CREATE UNIQUE INDEX guests_email_unique_idx ON guests (email) WHERE email IS NOT NULL AND email != '';
