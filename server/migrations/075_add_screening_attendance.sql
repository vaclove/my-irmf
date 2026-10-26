-- Migration: attendance entered by hand for a screening
-- School screenings, free-entry events and other admissions nobody scans at the
-- door. One head count per screening; it is added to the badge_scans of the
-- screening in the Tickets → Dashboard attendance figures.

CREATE TABLE IF NOT EXISTS screening_attendance (
  programming_id UUID PRIMARY KEY REFERENCES programming_schedule(id) ON DELETE CASCADE,
  count INTEGER NOT NULL CHECK (count >= 0),
  note TEXT,
  entered_by TEXT,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
