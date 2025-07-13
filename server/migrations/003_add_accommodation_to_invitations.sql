-- Migration: 003_add_accommodation_to_invitations.sql
-- Description: Add accommodation and covered_nights columns to guest_invitations table
-- Date: 2025-07-13

-- Add accommodation tracking columns to guest_invitations table
ALTER TABLE guest_invitations 
ADD COLUMN accommodation BOOLEAN DEFAULT false,
ADD COLUMN covered_nights INTEGER DEFAULT 0;