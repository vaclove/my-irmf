-- Migration: Fix status column data to match timestamps
-- Purpose: Update status column to reflect actual invitation state based on timestamps
-- Date: 2025-08-24

-- Update status column to match the actual state based on timestamps
-- This fixes inconsistency where status was 'pending' but timestamps indicated different states
UPDATE guest_invitations 
SET status = CASE 
  WHEN badge_printed_at IS NOT NULL THEN 'badge_printed'
  WHEN declined_at IS NOT NULL THEN 'declined'  
  WHEN confirmed_at IS NOT NULL THEN 'confirmed'
  WHEN opened_at IS NOT NULL THEN 'opened'
  ELSE status
END
WHERE status = 'pending' 
AND (confirmed_at IS NOT NULL OR declined_at IS NOT NULL OR badge_printed_at IS NOT NULL OR opened_at IS NOT NULL);