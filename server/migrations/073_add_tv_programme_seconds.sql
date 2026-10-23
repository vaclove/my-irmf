-- Migration: TV player — how long the programme slides stay on screen
-- programme_seconds: each page of the day's programme (the player's built-in 15 s before this column)
-- screening_seconds: each slide of a single screening (built-in 12 s before)

ALTER TABLE tv_settings ADD COLUMN IF NOT EXISTS programme_seconds INTEGER NOT NULL DEFAULT 15
  CHECK (programme_seconds BETWEEN 2 AND 120);
ALTER TABLE tv_settings ADD COLUMN IF NOT EXISTS screening_seconds INTEGER NOT NULL DEFAULT 12
  CHECK (screening_seconds BETWEEN 2 AND 120);
