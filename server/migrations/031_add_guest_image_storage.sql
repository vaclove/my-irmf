-- Description: Add S3 image storage support for guest photos
-- This migration adds image_path and migrates existing photos to S3

BEGIN;

-- Add new columns for S3 image storage
ALTER TABLE guests 
ADD COLUMN IF NOT EXISTS image_path VARCHAR(255),
ADD COLUMN IF NOT EXISTS image_migrated BOOLEAN DEFAULT FALSE;

-- Create index on image_path for faster lookups
CREATE INDEX IF NOT EXISTS idx_guests_image_path ON guests(image_path);

-- Add comment explaining the migration strategy
COMMENT ON COLUMN guests.image_path IS 'S3 base path for guest images (original, thumbnail, medium sizes)';
COMMENT ON COLUMN guests.image_migrated IS 'Flag indicating if photo was successfully migrated to S3';

-- Note: The actual photo migration will happen at application startup
-- to handle both development and production environments properly

COMMIT;