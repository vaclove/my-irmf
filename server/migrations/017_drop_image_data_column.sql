-- Description: Drop image_data column after successful migration to Azure Blob Storage

-- Drop the image_data column as all images have been migrated to blob storage
ALTER TABLE movies DROP COLUMN IF EXISTS image_data;

-- Add a comment to the table documenting the change
COMMENT ON TABLE movies IS 'Movie information with images stored in Azure Blob Storage (image_data column removed in migration 017)';