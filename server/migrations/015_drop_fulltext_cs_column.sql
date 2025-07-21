-- Migration: Drop fulltext_cs column from movies table
-- This migration removes the fulltext_cs column as it's no longer used

ALTER TABLE movies DROP COLUMN fulltext_cs;