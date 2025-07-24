-- Migration: Fix date storage to avoid timezone issues
-- This migration changes scheduled_date to store as text to avoid timezone conversion

-- First, convert existing dates to text format
UPDATE programming_schedule 
SET scheduled_date = (scheduled_date AT TIME ZONE 'UTC')::date;

-- Change the column type to text to avoid timezone issues
ALTER TABLE programming_schedule 
ALTER COLUMN scheduled_date TYPE TEXT 
USING scheduled_date::text;