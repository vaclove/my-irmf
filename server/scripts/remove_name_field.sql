-- Remove name field from guests table
-- Migration script to drop the redundant name column

-- Step 1: Remove the name column since we now use first_name and last_name
ALTER TABLE guests DROP COLUMN IF EXISTS name;

-- Step 2: Make first_name and last_name NOT NULL (if they aren't already)
ALTER TABLE guests 
ALTER COLUMN first_name SET NOT NULL,
ALTER COLUMN last_name SET NOT NULL;

-- Display updated table structure
\d guests;

-- Show sample data to verify
SELECT id, first_name, last_name, email, phone, language, company, notes
FROM guests 
ORDER BY first_name, last_name
LIMIT 5;