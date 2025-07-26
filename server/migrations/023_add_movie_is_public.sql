-- Migration 023: Add is_public column to movies table to control public catalogue visibility
-- Created: 2025-01-26

-- Add is_public column to movies table (defaults to true for existing movies)
ALTER TABLE movies 
ADD COLUMN is_public BOOLEAN DEFAULT true NOT NULL;

-- Add comment for clarity
COMMENT ON COLUMN movies.is_public IS 'Controls whether the movie is visible in the public catalogue';

-- Add index for performance when filtering public movies
CREATE INDEX idx_movies_is_public ON movies(is_public);