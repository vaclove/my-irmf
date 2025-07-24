-- Migration: Create programming system tables
-- This migration creates tables for venues, movie blocks, and programming schedule

-- Create venues table for festival locations
CREATE TABLE venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_cs VARCHAR(255) NOT NULL,
  name_en VARCHAR(255) NOT NULL,
  capacity INTEGER,
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create movie blocks table for grouping movies (especially short films)
CREATE TABLE movie_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  name_cs VARCHAR(255) NOT NULL,
  name_en VARCHAR(255),
  description_cs TEXT,
  description_en TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create junction table for movies in blocks
CREATE TABLE block_movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id UUID NOT NULL REFERENCES movie_blocks(id) ON DELETE CASCADE,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(block_id, movie_id)
);

-- Create programming schedule table
CREATE TABLE programming_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  
  -- Either movie_id OR block_id should be set, not both
  movie_id UUID REFERENCES movies(id) ON DELETE CASCADE,
  block_id UUID REFERENCES movie_blocks(id) ON DELETE CASCADE,
  
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  
  -- Runtime information
  base_runtime INTEGER, -- in minutes, calculated from movie(s)
  discussion_time INTEGER DEFAULT 0, -- additional time for discussion
  total_runtime INTEGER, -- base_runtime + discussion_time
  
  -- Additional information
  title_override_cs VARCHAR(255), -- Override title if needed
  title_override_en VARCHAR(255),
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ensure only one of movie_id or block_id is set
  CONSTRAINT chk_movie_or_block CHECK (
    (movie_id IS NOT NULL AND block_id IS NULL) OR 
    (movie_id IS NULL AND block_id IS NOT NULL)
  ),
  
  -- Prevent double booking (same venue, date, time)
  UNIQUE(venue_id, scheduled_date, scheduled_time)
);

-- Insert default venues
INSERT INTO venues (name_cs, name_en, capacity, sort_order) VALUES
('Malý sál', 'Small Hall', 80, 1),
('Velký sál', 'Great Hall', 200, 2),
('Kavárna', 'Café', 30, 3);

-- Create indexes for performance
CREATE INDEX idx_movie_blocks_edition_id ON movie_blocks(edition_id);
CREATE INDEX idx_block_movies_block_id ON block_movies(block_id);
CREATE INDEX idx_block_movies_movie_id ON block_movies(movie_id);
CREATE INDEX idx_programming_edition_id ON programming_schedule(edition_id);
CREATE INDEX idx_programming_venue_id ON programming_schedule(venue_id);
CREATE INDEX idx_programming_date_time ON programming_schedule(scheduled_date, scheduled_time);
CREATE INDEX idx_programming_movie_id ON programming_schedule(movie_id);
CREATE INDEX idx_programming_block_id ON programming_schedule(block_id);

-- Create update timestamp triggers
CREATE OR REPLACE FUNCTION update_venues_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_movie_blocks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_programming_schedule_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER venues_updated_at_trigger
  BEFORE UPDATE ON venues
  FOR EACH ROW
  EXECUTE FUNCTION update_venues_updated_at();

CREATE TRIGGER movie_blocks_updated_at_trigger
  BEFORE UPDATE ON movie_blocks
  FOR EACH ROW
  EXECUTE FUNCTION update_movie_blocks_updated_at();

CREATE TRIGGER programming_schedule_updated_at_trigger
  BEFORE UPDATE ON programming_schedule
  FOR EACH ROW
  EXECUTE FUNCTION update_programming_schedule_updated_at();

-- Create function to calculate runtime for blocks
CREATE OR REPLACE FUNCTION calculate_block_runtime(block_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  total_runtime INTEGER := 0;
  movie_runtime TEXT;
BEGIN
  -- Sum up all movie runtimes in the block
  FOR movie_runtime IN
    SELECT COALESCE(m.runtime, '0')
    FROM block_movies bm
    JOIN movies m ON bm.movie_id = m.id
    WHERE bm.block_id = block_uuid
  LOOP
    -- Convert runtime string to integer (assuming format like '90' for 90 minutes)
    BEGIN
      total_runtime := total_runtime + COALESCE(movie_runtime::INTEGER, 0);
    EXCEPTION WHEN invalid_text_representation THEN
      -- If runtime is not a valid integer, skip it
      CONTINUE;
    END;
  END LOOP;
  
  RETURN total_runtime;
END;
$$ LANGUAGE plpgsql;

-- Create function to update programming runtime automatically
CREATE OR REPLACE FUNCTION update_programming_runtime()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate base runtime based on movie or block
  IF NEW.movie_id IS NOT NULL THEN
    -- Single movie
    BEGIN
      NEW.base_runtime := COALESCE((
        SELECT COALESCE(runtime::INTEGER, 0)
        FROM movies 
        WHERE id = NEW.movie_id
      ), 0);
    EXCEPTION WHEN invalid_text_representation THEN
      NEW.base_runtime := 0;
    END;
  ELSIF NEW.block_id IS NOT NULL THEN
    -- Block of movies
    NEW.base_runtime := calculate_block_runtime(NEW.block_id);
  ELSE
    NEW.base_runtime := 0;
  END IF;
  
  -- Calculate total runtime
  NEW.total_runtime := COALESCE(NEW.base_runtime, 0) + COALESCE(NEW.discussion_time, 0);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER programming_runtime_trigger
  BEFORE INSERT OR UPDATE ON programming_schedule
  FOR EACH ROW
  EXECUTE FUNCTION update_programming_runtime();