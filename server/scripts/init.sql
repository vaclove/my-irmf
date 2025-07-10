-- Initial database setup
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tables
CREATE TABLE IF NOT EXISTS guests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS editions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year INTEGER UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE guest_category AS ENUM ('filmmaker', 'press', 'guest', 'staff');

CREATE TABLE IF NOT EXISTS guest_editions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
  edition_id UUID REFERENCES editions(id) ON DELETE CASCADE,
  category guest_category NOT NULL,
  invited_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  confirmation_token VARCHAR(255),
  UNIQUE(guest_id, edition_id)
);

-- Insert sample data
INSERT INTO guests (name, email, phone) VALUES 
  ('John Filmmaker', 'john@filmmaker.com', '+1234567890'),
  ('Jane Press', 'jane@press.com', '+1234567891'),
  ('Bob Guest', 'bob@guest.com', '+1234567892')
ON CONFLICT (email) DO NOTHING;

INSERT INTO editions (year, name, start_date, end_date) VALUES 
  (2025, 'Festival 2025', '2025-06-01', '2025-06-10')
ON CONFLICT (year) DO NOTHING;