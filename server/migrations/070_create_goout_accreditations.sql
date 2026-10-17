-- Migration: festival passes bought on GoOut, converted to our badges
-- (Tickets → Accreditations, server/services/goout-accreditations.js).
--
-- goout_accreditations: one row per converted GoOut pass ticket. The ticket id
--   (= the 13-digit code in its QR) is unique, so one GoOut pass can never
--   produce a second guest or badge, even when two desks convert it at once.
--   One guest holds at most one converted pass per edition. The scanner rejects
--   a converted pass, its holder enters with the badge.
--
-- NOTE (Azure): uses gen_random_uuid(), never the uuid-ossp extension.

CREATE TABLE IF NOT EXISTS goout_accreditations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goout_ticket_id VARCHAR(20) NOT NULL UNIQUE,
  goout_purchase_id VARCHAR(20),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  converted_by VARCHAR(255),
  converted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guest_id, edition_id)
);

CREATE INDEX IF NOT EXISTS idx_goout_accreditations_edition_id ON goout_accreditations(edition_id);
