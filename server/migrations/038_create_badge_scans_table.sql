-- Description: Create badge scan tracking system for screening attendance

-- Badge scans table to track when guests scan their badges at screenings
CREATE TABLE badge_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programming_id UUID NOT NULL REFERENCES programming_schedule(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  badge_number INTEGER NOT NULL,
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scanned_by VARCHAR(255), -- User who performed the scan

  -- Prevent duplicate scans (same guest at same screening)
  UNIQUE(programming_id, guest_id)
);

-- Create indexes for performance
CREATE INDEX idx_badge_scans_programming_id ON badge_scans(programming_id);
CREATE INDEX idx_badge_scans_guest_id ON badge_scans(guest_id);
CREATE INDEX idx_badge_scans_badge_number ON badge_scans(badge_number);
CREATE INDEX idx_badge_scans_scanned_at ON badge_scans(scanned_at);

-- Create function to get scan count for a screening
CREATE OR REPLACE FUNCTION get_screening_scan_count(programming_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  scan_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO scan_count
  FROM badge_scans
  WHERE programming_id = programming_uuid;

  RETURN scan_count;
END;
$$ LANGUAGE plpgsql;