-- Migration: Remove hardcoded section check constraint from movies table
-- This allows movies to use any section key defined in the sections table

-- Remove the old check constraint that limited sections to hardcoded values
ALTER TABLE movies DROP CONSTRAINT IF EXISTS movies_section_check;

-- The section column will now accept any string value
-- Validation will be handled at the application level using the sections table