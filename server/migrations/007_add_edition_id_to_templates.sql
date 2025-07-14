-- Migration: 007_add_edition_id_to_templates.sql
-- Description: Add edition_id to email_templates for template editor support
-- Date: 2025-07-14

-- Check if edition_id column already exists before adding it
DO $$ 
BEGIN
    -- Add edition_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'email_templates' AND column_name = 'edition_id'
    ) THEN
        ALTER TABLE email_templates ADD COLUMN edition_id UUID;
    END IF;
END $$;

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'email_templates_edition_id_fkey'
    ) THEN
        ALTER TABLE email_templates ADD CONSTRAINT email_templates_edition_id_fkey 
            FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Update existing templates to link to the first edition (if any exist)
DO $$ 
DECLARE
    first_edition_id UUID;
BEGIN
    -- Get the first edition ID
    SELECT id INTO first_edition_id FROM editions ORDER BY year LIMIT 1;
    
    -- If we have an edition and there are templates without edition_id, update them
    IF first_edition_id IS NOT NULL THEN
        UPDATE email_templates SET edition_id = first_edition_id WHERE edition_id IS NULL;
    END IF;
END $$;

-- Drop the old unique constraint on name if it exists
ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_name_key;

-- Add unique constraint on edition_id + language combination if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'email_templates_edition_language_unique'
    ) THEN
        ALTER TABLE email_templates ADD CONSTRAINT email_templates_edition_language_unique 
            UNIQUE (edition_id, language);
    END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_email_templates_edition_id ON email_templates(edition_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_edition_language ON email_templates(edition_id, language);