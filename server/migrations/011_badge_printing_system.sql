-- Description: Add badge printing system with sequential badge numbers, layouts, and category assignments

-- Badge numbers for guests per edition
CREATE TABLE guest_badge_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
  edition_id UUID REFERENCES editions(id) ON DELETE CASCADE,
  badge_number INTEGER NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guest_id, edition_id),
  UNIQUE(edition_id, badge_number)
);

-- Function to get next badge number for edition
CREATE OR REPLACE FUNCTION get_next_badge_number(edition_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
  next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(badge_number), 0) + 1 
  INTO next_number 
  FROM guest_badge_numbers 
  WHERE edition_id = edition_id_param;
  
  RETURN next_number;
END;
$$ LANGUAGE plpgsql;

-- Badge layouts table
CREATE TABLE badge_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID REFERENCES editions(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  canvas_width_mm DECIMAL(5,2) NOT NULL,
  canvas_height_mm DECIMAL(5,2) NOT NULL,
  background_color VARCHAR(7),
  background_image TEXT,
  layout_data JSONB NOT NULL, -- Element positions, styles, etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Category layout assignments
CREATE TABLE category_badge_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID REFERENCES editions(id) ON DELETE CASCADE,
  category guest_category NOT NULL,
  layout_id UUID REFERENCES badge_layouts(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(edition_id, category)
);

-- Indexes for performance
CREATE INDEX idx_guest_badge_numbers_edition ON guest_badge_numbers(edition_id);
CREATE INDEX idx_guest_badge_numbers_guest ON guest_badge_numbers(guest_id);
CREATE INDEX idx_badge_layouts_edition ON badge_layouts(edition_id);
CREATE INDEX idx_category_badge_assignments_edition ON category_badge_assignments(edition_id);