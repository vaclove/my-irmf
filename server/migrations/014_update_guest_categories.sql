-- Migration: Add 'public' guest category
-- Date: 2025-10-11

-- Add new 'public' category to the enum
ALTER TYPE guest_category ADD VALUE IF NOT EXISTS 'public';
