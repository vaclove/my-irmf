-- Migration: Add language and subtitles fields to movies table
-- This migration adds language and subtitles columns to support multilingual movie information

ALTER TABLE movies 
ADD COLUMN language VARCHAR(100),
ADD COLUMN subtitles TEXT;

-- Add comment for documentation
COMMENT ON COLUMN movies.language IS 'Original language of the movie';
COMMENT ON COLUMN movies.subtitles IS 'Available subtitles - can be multiple, comma-separated (e.g., "Czech", "English", "Czech + English")';