-- Migration: Revert date storage back to proper DATE type
-- This migration changes scheduled_date back to DATE type

-- Change the column type back to DATE
ALTER TABLE programming_schedule 
ALTER COLUMN scheduled_date TYPE DATE 
USING scheduled_date::date;