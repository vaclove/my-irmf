-- Migration: Add extra accommodation nights feature
-- Date: 2025-08-26
-- Description: Add fields to track guest requests for additional nights beyond festival coverage

-- Add columns to guest_invitations for tracking extra nights
ALTER TABLE guest_invitations 
ADD COLUMN IF NOT EXISTS requested_extra_nights INTEGER DEFAULT 0 CHECK (requested_extra_nights >= 0),
ADD COLUMN IF NOT EXISTS extra_nights_comment TEXT,
ADD COLUMN IF NOT EXISTS extra_nights_status VARCHAR(50) DEFAULT 'not_requested' 
  CHECK (extra_nights_status IN ('not_requested', 'pending_approval', 'approved', 'rejected')),
ADD COLUMN IF NOT EXISTS extra_nights_approved_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS extra_nights_approved_at TIMESTAMP;

-- Add column to accommodation_selections for marking which nights are extra (paid by guest)
ALTER TABLE accommodation_selections
ADD COLUMN IF NOT EXISTS is_extra_night BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS price_per_night DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'CZK',
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'not_required' 
  CHECK (payment_status IN ('not_required', 'pending', 'paid', 'cancelled'));

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_guest_invitations_extra_nights_status 
  ON guest_invitations(extra_nights_status) 
  WHERE extra_nights_status != 'not_requested';

-- Add comments for documentation
COMMENT ON COLUMN guest_invitations.requested_extra_nights IS 'Number of additional nights requested beyond covered_nights';
COMMENT ON COLUMN guest_invitations.extra_nights_comment IS 'Guest comment about why they need extra nights';
COMMENT ON COLUMN guest_invitations.extra_nights_status IS 'Status of extra nights request: not_requested, pending_approval, approved, rejected';
COMMENT ON COLUMN guest_invitations.extra_nights_approved_by IS 'Email of admin who approved/rejected extra nights';
COMMENT ON COLUMN guest_invitations.extra_nights_approved_at IS 'Timestamp when extra nights were approved/rejected';

COMMENT ON COLUMN accommodation_selections.is_extra_night IS 'Whether this night is extra (beyond covered nights) and needs to be paid';
COMMENT ON COLUMN accommodation_selections.price_per_night IS 'Price for this night if it is an extra night';
COMMENT ON COLUMN accommodation_selections.currency IS 'Currency for the price (default CZK)';
COMMENT ON COLUMN accommodation_selections.payment_status IS 'Payment status for extra night: not_required, pending, paid, cancelled';