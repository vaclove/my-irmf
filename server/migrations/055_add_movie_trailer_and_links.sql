-- Migration: Add trailer and external links to movies
-- Trailer (YouTube/Vimeo or any video URL), the film's website and its Facebook
-- and Instagram pages. Shown on the public film detail on irmf.cz / irmf.net.
-- All optional; the API accepts only http(s) URLs.

ALTER TABLE movies ADD COLUMN IF NOT EXISTS trailer_url TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS facebook_url TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS instagram_url TEXT;

COMMENT ON COLUMN movies.trailer_url IS 'Trailer URL; YouTube and Vimeo links are embedded on the public site';
COMMENT ON COLUMN movies.website_url IS 'Film website (may be the director''s or producer''s page)';
COMMENT ON COLUMN movies.facebook_url IS 'Film Facebook page';
COMMENT ON COLUMN movies.instagram_url IS 'Film Instagram profile';
