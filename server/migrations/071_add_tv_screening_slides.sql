-- Migration: TV player — switch off the slide per screening
-- screening_slides: after the day's programme the player shows every screening
-- on its own full-screen slide (true, as before), or the programme alone
-- (false, e.g. when the films are announced by photo slides instead).

ALTER TABLE tv_settings ADD COLUMN IF NOT EXISTS screening_slides BOOLEAN NOT NULL DEFAULT true;
