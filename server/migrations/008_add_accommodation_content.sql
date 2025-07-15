-- Migration: Add accommodation_content field to email_templates
-- Date: 2025-01-15
-- Description: Add separate field for accommodation content in email templates

ALTER TABLE email_templates 
ADD COLUMN accommodation_content TEXT;

-- Add comment explaining the field
COMMENT ON COLUMN email_templates.accommodation_content IS 'Custom accommodation text content that replaces {{accommodation_info}} variable in email templates';