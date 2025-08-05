-- Migration: Create accommodation management system
-- Date: 2025-08-05
-- Description: Create tables for hotels, room types, and availability management

-- Hotels table - stores hotel information for each edition
CREATE TABLE IF NOT EXISTS hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  description TEXT,
  contact_phone VARCHAR(50),
  contact_email VARCHAR(255),
  website VARCHAR(255),
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Room types table - different types of rooms in hotels
CREATE TABLE IF NOT EXISTS room_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  price_per_night DECIMAL(10,2),
  currency VARCHAR(3) DEFAULT 'CZK',
  amenities TEXT[], -- Array of amenities like ['WiFi', 'TV', 'Bathroom']
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Room availability table - tracks available rooms per date
CREATE TABLE IF NOT EXISTS room_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  available_date DATE NOT NULL,
  total_rooms INTEGER NOT NULL CHECK (total_rooms >= 0),
  reserved_rooms INTEGER DEFAULT 0 CHECK (reserved_rooms >= 0),
  available_rooms INTEGER GENERATED ALWAYS AS (total_rooms - reserved_rooms) STORED,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(room_type_id, available_date)
);

-- Guest room reservations table - tracks which guests are assigned to which rooms
CREATE TABLE IF NOT EXISTS guest_room_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES guest_invitations(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  guests_count INTEGER NOT NULL CHECK (guests_count > 0),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_dates CHECK (check_out_date > check_in_date)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_hotels_edition_id ON hotels(edition_id);
CREATE INDEX IF NOT EXISTS idx_hotels_active ON hotels(active);

CREATE INDEX IF NOT EXISTS idx_room_types_hotel_id ON room_types(hotel_id);
CREATE INDEX IF NOT EXISTS idx_room_types_active ON room_types(active);

CREATE INDEX IF NOT EXISTS idx_room_availability_room_type_date ON room_availability(room_type_id, available_date);
CREATE INDEX IF NOT EXISTS idx_room_availability_date ON room_availability(available_date);

CREATE INDEX IF NOT EXISTS idx_guest_room_reservations_invitation ON guest_room_reservations(invitation_id);
CREATE INDEX IF NOT EXISTS idx_guest_room_reservations_room_type ON guest_room_reservations(room_type_id);
CREATE INDEX IF NOT EXISTS idx_guest_room_reservations_dates ON guest_room_reservations(check_in_date, check_out_date);

-- Add comments for documentation
COMMENT ON TABLE hotels IS 'Hotels available for each festival edition';
COMMENT ON TABLE room_types IS 'Different types of rooms available in hotels';
COMMENT ON TABLE room_availability IS 'Daily availability tracking for each room type';
COMMENT ON TABLE guest_room_reservations IS 'Actual room reservations for guests';

COMMENT ON COLUMN room_types.capacity IS 'Maximum number of guests per room';
COMMENT ON COLUMN room_availability.available_rooms IS 'Computed: total_rooms - reserved_rooms';
COMMENT ON COLUMN guest_room_reservations.guests_count IS 'Number of guests in this reservation';