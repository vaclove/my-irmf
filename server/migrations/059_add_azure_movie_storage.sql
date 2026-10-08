-- Migration: movie files on Azure Blob Storage
-- The primary copy of movie files moves to Azure Blob (account irmfmovies):
-- masters in the Cold tier, previews and subtitles in Hot. Google Drive stays
-- as the human-facing backup: masters and subtitles keep a copy there, the
-- preview proxy lives only in Azure. Older editions stay on Drive.
--
-- movie_files.storage says where the primary copy lives:
--   'drive' — legacy row: drive_file_id/file_name/size/md5 describe the Drive file
--   'azure' — blob_name/file_name/size/md5 describe the blob; drive_file_id is the
--             Drive copy (or NULL) and drive_md5_checksum the md5 of that copy as
--             last written/synced by the app (a different current md5 means it
--             was edited on Drive outside the app)
--
-- Job tables keep their *_drive_file_id column names but now hold a "file ref":
-- 'blob:<blob name>' for Azure files, a bare Drive file id for Drive files.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

ALTER TABLE movie_files ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'drive';
ALTER TABLE movie_files DROP CONSTRAINT IF EXISTS movie_files_storage_check;
ALTER TABLE movie_files ADD CONSTRAINT movie_files_storage_check
  CHECK (storage IN ('drive', 'azure'));
ALTER TABLE movie_files ADD COLUMN IF NOT EXISTS blob_name TEXT;
ALTER TABLE movie_files ADD COLUMN IF NOT EXISTS blob_etag TEXT;
ALTER TABLE movie_files ADD COLUMN IF NOT EXISTS drive_md5_checksum TEXT;
ALTER TABLE movie_files ALTER COLUMN drive_file_id DROP NOT NULL;
ALTER TABLE movie_files DROP CONSTRAINT IF EXISTS movie_files_location_check;
ALTER TABLE movie_files ADD CONSTRAINT movie_files_location_check CHECK (
  (storage = 'drive' AND drive_file_id IS NOT NULL) OR
  (storage = 'azure' AND blob_name IS NOT NULL)
);

-- Background copies between Drive and Azure, run by the movie worker:
--   drive_to_azure — import a Drive file into Azure (migration, files dropped
--                    into the Drive folder by hand)
--   azure_to_drive — write the Drive backup of an Azure master
CREATE TABLE IF NOT EXISTS movie_file_transfer_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  file_kind TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('drive_to_azure', 'azure_to_drive')),
  source_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  bytes_total BIGINT,
  bytes_transferred BIGINT NOT NULL DEFAULT 0,
  attempt_count INT NOT NULL DEFAULT 0,
  -- Re-run the preview transcode once a master import finishes.
  transcode_after BOOLEAN NOT NULL DEFAULT false,
  -- drive_to_azure: a person chose this file for the slot (import with
  -- replace) — apply even if the row changed meanwhile. Automatic imports only
  -- apply while the row still is the legacy Drive row they were queued for.
  replace_existing BOOLEAN NOT NULL DEFAULT false,
  target_ref TEXT,
  error_message TEXT,
  created_by TEXT,
  dismissed_at TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_movie_file_transfer_jobs_movie
  ON movie_file_transfer_jobs(movie_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_movie_file_transfer_jobs_one_active
  ON movie_file_transfer_jobs(movie_id, file_kind, direction)
  WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION update_movie_file_transfer_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS movie_file_transfer_jobs_updated_at_trigger ON movie_file_transfer_jobs;
CREATE TRIGGER movie_file_transfer_jobs_updated_at_trigger
  BEFORE UPDATE ON movie_file_transfer_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_movie_file_transfer_jobs_updated_at();
