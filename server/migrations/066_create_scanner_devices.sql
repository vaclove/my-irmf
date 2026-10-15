-- Migration: phones as scanners without logging in.
-- Staff create a link (shown as a QR code) for a screening; phones join it within
-- 15 minutes and may then scan that screening and the later ones in the same venue
-- on that day, until 1 hour after the last of them ends.
-- Tokens are stored as SHA-256 hashes only.
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

CREATE TABLE IF NOT EXISTS scanner_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programming_id UUID NOT NULL REFERENCES programming_schedule(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  join_until TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS scanner_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES scanner_links(id) ON DELETE CASCADE,
  operator_name VARCHAR(100) NOT NULL,
  session_hash VARCHAR(64) NOT NULL UNIQUE,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  disconnected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scanner_links_programming_id ON scanner_links(programming_id);
CREATE INDEX IF NOT EXISTS idx_scanner_devices_link_id ON scanner_devices(link_id);

-- Which phone made a scan (NULL for staff scans)
ALTER TABLE badge_scans
ADD COLUMN IF NOT EXISTS scanner_device_id UUID REFERENCES scanner_devices(id) ON DELETE SET NULL;
