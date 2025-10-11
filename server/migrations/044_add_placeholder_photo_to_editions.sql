-- Migration: Add placeholder photo field to editions table
-- This allows setting a default photo for guests without their own photo

ALTER TABLE editions
ADD COLUMN placeholder_photo TEXT;

COMMENT ON COLUMN editions.placeholder_photo IS 'Default photo URL to use for guests without their own photo in this edition';
