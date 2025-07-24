-- Migration: Create sections table for customizable movie sections
-- This migration creates the sections table to replace hardcoded sections with configurable ones

CREATE TABLE sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  key VARCHAR(50) NOT NULL, -- Internal key (feature, documentary, etc.)
  name_cs VARCHAR(255) NOT NULL,
  name_en VARCHAR(255) NOT NULL,
  color_code VARCHAR(7) NOT NULL, -- Hex color code #RRGGBB
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ensure unique key per edition
  UNIQUE(edition_id, key)
);

-- Create indexes for performance
CREATE INDEX idx_sections_edition_id ON sections(edition_id);
CREATE INDEX idx_sections_key ON sections(key);
CREATE INDEX idx_sections_sort_order ON sections(sort_order);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sections_updated_at_trigger
  BEFORE UPDATE ON sections
  FOR EACH ROW
  EXECUTE FUNCTION update_sections_updated_at();

-- Insert default sections for existing editions
-- Note: This will need to be run after the migration to populate default sections
-- We'll do this via a separate script or API call to ensure proper edition handling