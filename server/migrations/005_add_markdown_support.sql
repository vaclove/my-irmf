-- Migration: 005_add_markdown_support.sql
-- Description: Add markdown_content field to email_templates table for template editor
-- Date: 2025-07-14

-- Add markdown_content field for storing Markdown-based templates
ALTER TABLE email_templates ADD COLUMN markdown_content TEXT;

-- Add index for better performance when querying by language
CREATE INDEX IF NOT EXISTS idx_email_templates_language ON email_templates(language);

-- Create trigger to update updated_at when markdown_content changes
CREATE OR REPLACE FUNCTION update_email_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for email_templates table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'trigger_update_email_template_timestamp'
        AND tgrelid = 'email_templates'::regclass
    ) THEN
        CREATE TRIGGER trigger_update_email_template_timestamp
            BEFORE UPDATE ON email_templates
            FOR EACH ROW
            EXECUTE FUNCTION update_email_template_timestamp();
    END IF;
END $$;