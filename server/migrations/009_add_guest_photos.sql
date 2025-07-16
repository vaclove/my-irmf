-- Migration 009: Add photo support to guests table
-- Add photo column to store base64 encoded JPEG images (500x500px, 90% quality)

-- Add photo column to guests table (only if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'guests' AND column_name = 'photo') THEN
        ALTER TABLE guests ADD COLUMN photo TEXT;
    END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN guests.photo IS 'Base64 encoded JPEG image, 500x500px, 90% quality';

-- Create index for guests with photos (for potential filtering)
CREATE INDEX IF NOT EXISTS idx_guests_has_photo ON guests ((photo IS NOT NULL));

-- Add constraint to prevent extremely large photos (500KB limit for base64)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints 
                   WHERE constraint_name = 'photo_size_limit') THEN
        ALTER TABLE guests ADD CONSTRAINT photo_size_limit CHECK (LENGTH(photo) <= 500000);
    END IF;
END $$;