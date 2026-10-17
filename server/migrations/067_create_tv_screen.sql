-- Migration: TV player on the venue screen (/tv/), managed in Programme → TV Screen.
--
-- tv_settings: a single row (id = 1)
--   programme_days       'today'    — the day's programme only (before the festival its
--                                     first day, once today is over the next day)
--                        'upcoming' — that day followed by every later festival day
--   reload_requested_at  "Reload screens" in the admin: players that loaded before
--                        this time drop their cached page and load it again
--
-- tv_slides: what the player loops through, in sort_order. 'programme' is the
-- programme of the day (one row, created here, cannot be deleted); 'photo' and
-- 'video' are uploaded files. Hidden slides stay in the list but are skipped.
--   Files live in the movie storage account (MOVIE_STORAGE_CONTAINER) under
--   tv/<slide id>/: photos are resized to fit 1920×1080 on upload; videos are
--   uploaded by the browser as source_blob_name and the worker transcodes them to
--   a 1080p H.264 MP4 (blob_name), status uploading → processing → ready | failed.
--   movie_id links a trailer to its film: the player shows its next screening.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

CREATE TABLE IF NOT EXISTS tv_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  programme_days VARCHAR(20) NOT NULL DEFAULT 'today'
    CHECK (programme_days IN ('today', 'upcoming')),
  reload_requested_at TIMESTAMPTZ,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tv_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS tv_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('programme', 'photo', 'video')),
  title VARCHAR(255),
  movie_id UUID REFERENCES movies(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden BOOLEAN NOT NULL DEFAULT false,
  display_seconds INTEGER CHECK (display_seconds BETWEEN 2 AND 120),
  status VARCHAR(20) NOT NULL DEFAULT 'ready'
    CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  progress_percent INTEGER,
  error_message TEXT,
  source_blob_name TEXT,
  blob_name TEXT,
  file_name TEXT,
  size BIGINT,
  width INTEGER,
  height INTEGER,
  media_seconds NUMERIC(10, 2),
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tv_slides_sort_order ON tv_slides (sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tv_slides_one_programme ON tv_slides (kind) WHERE kind = 'programme';

INSERT INTO tv_slides (kind, title, sort_order)
SELECT 'programme', 'Programme', 0
WHERE NOT EXISTS (SELECT 1 FROM tv_slides WHERE kind = 'programme');
