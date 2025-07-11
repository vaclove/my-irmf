-- Split name field into first_name and last_name
-- Migration script to handle existing data

-- Step 1: Add new columns
ALTER TABLE guests 
ADD COLUMN IF NOT EXISTS first_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);

-- Step 2: Migrate existing data by splitting the name field
-- This assumes names are in "First Last" format
UPDATE guests 
SET 
    first_name = CASE 
        WHEN position(' ' in name) > 0 THEN 
            trim(substring(name from 1 for position(' ' in name) - 1))
        ELSE 
            trim(name)
    END,
    last_name = CASE 
        WHEN position(' ' in name) > 0 THEN 
            trim(substring(name from position(' ' in name) + 1))
        ELSE 
            ''
    END
WHERE first_name IS NULL OR last_name IS NULL;

-- Step 3: Make the new fields NOT NULL after migration
-- (We'll do this in a separate step after verifying the migration worked)

-- Step 4: Update any views or functions that use the name field
-- Create a computed column expression for backward compatibility
-- We'll handle this in the application layer for now

-- Display migration results
SELECT 
    id,
    name as original_name,
    first_name,
    last_name,
    CONCAT(first_name, ' ', last_name) as combined_name
FROM guests
ORDER BY name;