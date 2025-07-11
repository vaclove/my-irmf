-- Add guest tagging system
-- Migration script to create tags and guest-tag relationships

-- Step 1: Create tags table
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) UNIQUE NOT NULL,
  color VARCHAR(7) DEFAULT '#3B82F6', -- Default blue color
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Create guest-tag relationship table
CREATE TABLE IF NOT EXISTS guest_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guest_id, tag_id)
);

-- Step 3: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_guest_tags_guest_id ON guest_tags(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_tags_tag_id ON guest_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

-- Step 4: Insert some sample tags
INSERT INTO tags (name, color) VALUES 
  ('VIP', '#EF4444'),
  ('Press', '#3B82F6'),
  ('Filmmaker', '#8B5CF6'),
  ('Industry', '#F59E0B'),
  ('Local', '#10B981'),
  ('International', '#6366F1')
ON CONFLICT (name) DO NOTHING;

-- Display the new table structures
\d tags;
\d guest_tags;

-- Show sample data
SELECT * FROM tags ORDER BY name;