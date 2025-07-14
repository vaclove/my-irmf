-- Migration: 004_add_greeting_fields.sql
-- Description: Add greeting and greeting_auto_generated fields to guests table
-- Date: 2025-07-14

-- Add greeting fields to guests table
ALTER TABLE guests ADD COLUMN greeting VARCHAR(255);
ALTER TABLE guests ADD COLUMN greeting_auto_generated BOOLEAN DEFAULT true;

-- Create index for performance when filtering by auto-generated greetings
CREATE INDEX idx_guests_greeting_auto_generated ON guests(greeting_auto_generated);