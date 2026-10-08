-- Migration: manual "files ready" mark on movies
-- A person sets this by hand on the Files & Subtitles tab once they are happy
-- with the movie file, preview and subtitles. Purely informational: nothing
-- clears it automatically, it is unset by hand too.

ALTER TABLE movies ADD COLUMN IF NOT EXISTS files_ready_at TIMESTAMP;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS files_ready_by TEXT;

COMMENT ON COLUMN movies.files_ready_at IS 'When someone marked the movie files and subtitles as ready (NULL = not ready)';
COMMENT ON COLUMN movies.files_ready_by IS 'Email of the user who marked the files as ready';
