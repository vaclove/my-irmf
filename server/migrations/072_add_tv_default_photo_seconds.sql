-- Migration: TV player — how long a photo slide stays on screen by default
-- default_photo_seconds: used by every photo slide without its own
-- tv_slides.display_seconds (the player's built-in 8 s before this column).

ALTER TABLE tv_settings ADD COLUMN IF NOT EXISTS default_photo_seconds INTEGER NOT NULL DEFAULT 8
  CHECK (default_photo_seconds BETWEEN 2 AND 120);
