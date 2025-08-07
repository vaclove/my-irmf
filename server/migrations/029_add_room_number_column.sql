-- Migration: Add room_number column to guest_room_reservations
-- Date: 2025-08-07
-- Description: Add room_number field to track actual room assignments

-- Add room_number column to guest_room_reservations table
ALTER TABLE guest_room_reservations 
ADD COLUMN IF NOT EXISTS room_number VARCHAR(50);

-- Create index for room number lookups
CREATE INDEX IF NOT EXISTS idx_guest_room_reservations_room_number 
ON guest_room_reservations(room_number) 
WHERE room_number IS NOT NULL;

-- Add comment explaining the new column
COMMENT ON COLUMN guest_room_reservations.room_number IS 'Actual room number assigned to the guest (e.g., "101", "A-205", "Suite 12")';