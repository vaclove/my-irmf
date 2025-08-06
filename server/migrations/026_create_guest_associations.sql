-- Migration: Create guest association tables
-- This migration creates tables for guest relationships and movie delegations
-- Date: 2025-08-06

-- Guest-to-Guest relationships (plus ones, companions, etc.)
CREATE TABLE guest_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
  related_guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL CHECK (relationship_type IN ('plus_one', 'companion', 'spouse', 'partner')),
  edition_id UUID REFERENCES editions(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(primary_guest_id, related_guest_id, edition_id),
  -- Ensure a guest can't be related to themselves
  CHECK (primary_guest_id != related_guest_id)
);

-- Guest-to-Movie delegations (directors, producers, actors, etc.)
CREATE TABLE movie_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
  movie_id UUID REFERENCES movies(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('director', 'producer', 'actor', 'delegation_member', 'distributor', 'sales_agent')),
  is_primary BOOLEAN DEFAULT false, -- main contact for the movie
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guest_id, movie_id, role)
);

-- Create indexes for performance
CREATE INDEX idx_guest_relationships_primary ON guest_relationships(primary_guest_id);
CREATE INDEX idx_guest_relationships_related ON guest_relationships(related_guest_id);
CREATE INDEX idx_guest_relationships_edition ON guest_relationships(edition_id);
CREATE INDEX idx_guest_relationships_type ON guest_relationships(relationship_type);

CREATE INDEX idx_movie_delegations_guest ON movie_delegations(guest_id);
CREATE INDEX idx_movie_delegations_movie ON movie_delegations(movie_id);
CREATE INDEX idx_movie_delegations_role ON movie_delegations(role);
CREATE INDEX idx_movie_delegations_primary ON movie_delegations(is_primary) WHERE is_primary = true;

-- Create function to automatically set has_delegation flag on movies
CREATE OR REPLACE FUNCTION update_movie_has_delegation()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the movie's has_delegation flag based on delegation existence
  IF TG_OP = 'INSERT' THEN
    UPDATE movies SET has_delegation = true WHERE id = NEW.movie_id;
  ELSIF TG_OP = 'DELETE' THEN
    -- Check if there are any remaining delegations for this movie
    UPDATE movies 
    SET has_delegation = (
      SELECT COUNT(*) > 0 
      FROM movie_delegations 
      WHERE movie_id = OLD.movie_id
    )
    WHERE id = OLD.movie_id;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers to maintain has_delegation flag
CREATE TRIGGER movie_delegations_insert_trigger
  AFTER INSERT ON movie_delegations
  FOR EACH ROW
  EXECUTE FUNCTION update_movie_has_delegation();

CREATE TRIGGER movie_delegations_delete_trigger
  AFTER DELETE ON movie_delegations
  FOR EACH ROW
  EXECUTE FUNCTION update_movie_has_delegation();