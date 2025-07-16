-- Migration 010: Increase photo size limit for larger uploads
-- Update from 500KB to 1MB limit to accommodate 10MB source images compressed to 500x500 JPEG

-- Drop existing constraint
ALTER TABLE guests DROP CONSTRAINT IF EXISTS photo_size_limit;

-- Add new constraint with higher limit (1MB for base64 encoded data)
ALTER TABLE guests ADD CONSTRAINT photo_size_limit CHECK (LENGTH(photo) <= 1000000);

-- Update comment
COMMENT ON COLUMN guests.photo IS 'Base64 encoded JPEG image, 500x500px, 90% quality, max 10MB source file';