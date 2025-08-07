-- Migration: Add room sharing capabilities
-- Date: 2025-08-07
-- Description: Modify guest_room_reservations to support multiple guests per reservation

-- First, let's add a room_group_id to group multiple invitations together
ALTER TABLE guest_room_reservations 
ADD COLUMN IF NOT EXISTS room_group_id UUID,
ADD COLUMN IF NOT EXISTS is_primary_booking BOOLEAN DEFAULT true;

-- Create an index for room_group_id for better query performance
CREATE INDEX IF NOT EXISTS idx_guest_room_reservations_room_group 
ON guest_room_reservations(room_group_id) 
WHERE room_group_id IS NOT NULL;

-- Create a view to easily see room sharing groups
CREATE OR REPLACE VIEW room_sharing_groups AS
SELECT 
  COALESCE(grr.room_group_id, grr.id) as group_id,
  rt.name as room_type,
  h.name as hotel,
  grr.check_in_date,
  grr.check_out_date,
  rt.capacity as room_capacity,
  COUNT(DISTINCT grr.invitation_id) as guests_in_room,
  STRING_AGG(g.first_name || ' ' || g.last_name, ', ' ORDER BY grr.is_primary_booking DESC, g.last_name, g.first_name) as guest_names,
  ARRAY_AGG(grr.invitation_id ORDER BY grr.is_primary_booking DESC) as invitation_ids,
  ARRAY_AGG(grr.id ORDER BY grr.is_primary_booking DESC) as reservation_ids,
  (ARRAY_AGG(grr.id ORDER BY grr.is_primary_booking DESC NULLS LAST))[1] as primary_reservation_id
FROM guest_room_reservations grr
JOIN room_types rt ON grr.room_type_id = rt.id
JOIN hotels h ON rt.hotel_id = h.id
JOIN guest_invitations gi ON grr.invitation_id = gi.id
JOIN guests g ON gi.guest_id = g.id
WHERE grr.status != 'cancelled'
GROUP BY COALESCE(grr.room_group_id, grr.id), rt.name, h.name, grr.check_in_date, grr.check_out_date, rt.capacity;

-- Add comment explaining the new columns
COMMENT ON COLUMN guest_room_reservations.room_group_id IS 'Groups multiple guests sharing the same room. All reservations with the same room_group_id share a room.';
COMMENT ON COLUMN guest_room_reservations.is_primary_booking IS 'Indicates if this is the primary booking for the room (for billing/management purposes)';
COMMENT ON VIEW room_sharing_groups IS 'View showing all room sharing arrangements with guest counts and names';