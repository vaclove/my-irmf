-- Migration: Create movies table
-- This migration creates the movies table to store movie information linked to festival editions

CREATE TABLE movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mysql_id INTEGER UNIQUE, -- Reference to original MySQL ID for migration
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  catalogue_year VARCHAR(4),
  name_cs TEXT NOT NULL,
  name_en TEXT,
  synopsis_cs TEXT,
  synopsis_en TEXT,
  fulltext_cs TEXT NOT NULL,
  image TEXT, -- Original image path/URL
  image_data TEXT, -- Base64 encoded image data
  runtime VARCHAR(3),
  director TEXT,
  year INTEGER,
  country TEXT,
  "cast" TEXT,
  premiere VARCHAR(20) CHECK (premiere IN ('czech', 'european', 'world', '')),
  section VARCHAR(20) CHECK (section IN ('feature', 'documentary', 'short', 'retrospective', 'special', 'workshop', 'concert', 'discussion')),
  is_35mm BOOLEAN NOT NULL DEFAULT false,
  has_delegation BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_movies_edition_id ON movies(edition_id);
CREATE INDEX idx_movies_year ON movies(year);
CREATE INDEX idx_movies_section ON movies(section);
CREATE INDEX idx_movies_catalogue_year ON movies(catalogue_year);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_movies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movies_updated_at_trigger
  BEFORE UPDATE ON movies
  FOR EACH ROW
  EXECUTE FUNCTION update_movies_updated_at();