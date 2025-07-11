-- Migrate to tag-based guest assignments
-- This script removes manual assignments and creates year-based tags for automatic assignment

-- Step 1: Clear all existing guest assignments
DELETE FROM guest_editions;

-- Step 2: Create year-based tags for automatic edition assignment
-- Get all existing editions and create corresponding year tags
INSERT INTO tags (name, color)
SELECT 
  e.year::text as name,
  '#4338CA' as color -- Indigo color for year tags
FROM editions e
WHERE NOT EXISTS (
  SELECT 1 FROM tags t WHERE t.name = e.year::text
);

-- Step 3: Add some category tags that can be used with year tags
INSERT INTO tags (name, color) VALUES 
  ('filmmaker', '#8B5CF6'),
  ('press', '#3B82F6'),
  ('guest', '#10B981'),
  ('staff', '#F59E0B')
ON CONFLICT (name) DO NOTHING;

-- Step 4: Display the new year tags
SELECT t.*, e.name as edition_name, e.start_date, e.end_date
FROM tags t
JOIN editions e ON t.name = e.year::text
ORDER BY e.year DESC;

-- Step 5: Show all tags
SELECT * FROM tags ORDER BY 
  CASE 
    WHEN name ~ '^[0-9]+$' THEN 1  -- Year tags first
    ELSE 2                         -- Other tags second
  END,
  name;