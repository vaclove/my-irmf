-- Migration: SEO-friendly film URLs
-- The public sites address a film as /katalog/<edition year>/<slug_cs>/ (irmf.cz)
-- and /catalogue/<edition year>/<slug_en>/ (irmf.net). Slugs are stored, not
-- derived on the fly, so fixing a typo in a title does not break published links.
--
-- A trigger owns the slugs: a missing or empty slug is generated from the
-- title in that language (falling back to the other one, then 'film'), with
-- -2, -3, ... when the edition already has it. A slug typed in the admin is
-- normalised by the same function. Renaming a film keeps its slug.

-- Lowercase ASCII slug: Latin diacritics folded, anything else collapsed to '-'.
-- Non-Latin titles (Cyrillic, ...) produce '' and the caller falls back.
CREATE OR REPLACE FUNCTION movie_slugify(input TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' from left(trim(both '-' from regexp_replace(
    translate(
      replace(replace(replace(replace(lower(coalesce(input, '')), 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), 'þ', 'th'),
      'áàâäãåāăąçćĉċčďđéèêëēĕėęěğĝġģĥħíìîïĩīĭįıĵķĺļľŀłñńņňŉóòôöõōŏőøŕŗřśŝşšșţťŧțúùûüũūŭůűųŵýÿŷźżž',
      'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijklllllnnnnnooooooooorrrsssssttttuuuuuuuuuuwyyyzzz'
    ),
    '[^a-z0-9]+', '-', 'g'
  )), 80))
$$;

CREATE OR REPLACE FUNCTION movies_fill_slugs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  NEW.slug_cs := NULLIF(movie_slugify(NEW.slug_cs), '');
  NEW.slug_en := NULLIF(movie_slugify(NEW.slug_en), '');

  IF NEW.slug_cs IS NULL THEN
    base := COALESCE(NULLIF(movie_slugify(NEW.name_cs), ''), NULLIF(movie_slugify(NEW.name_en), ''), 'film');
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM movies WHERE edition_id = NEW.edition_id AND slug_cs = candidate AND id <> NEW.id) LOOP
      n := n + 1;
      candidate := base || '-' || n;
    END LOOP;
    NEW.slug_cs := candidate;
  END IF;

  IF NEW.slug_en IS NULL THEN
    base := COALESCE(NULLIF(movie_slugify(NEW.name_en), ''), NULLIF(movie_slugify(NEW.name_cs), ''), 'film');
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM movies WHERE edition_id = NEW.edition_id AND slug_en = candidate AND id <> NEW.id) LOOP
      n := n + 1;
      candidate := base || '-' || n;
    END LOOP;
    NEW.slug_en := candidate;
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE movies ADD COLUMN IF NOT EXISTS slug_cs VARCHAR(100);
ALTER TABLE movies ADD COLUMN IF NOT EXISTS slug_en VARCHAR(100);

DROP TRIGGER IF EXISTS trg_movies_fill_slugs ON movies;
CREATE TRIGGER trg_movies_fill_slugs
  BEFORE INSERT OR UPDATE OF slug_cs, slug_en ON movies
  FOR EACH ROW EXECUTE FUNCTION movies_fill_slugs();

-- Backfill one film at a time, oldest first, so the earlier film of two
-- same-titled ones in an edition gets the plain slug
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM movies WHERE slug_cs IS NULL OR slug_en IS NULL ORDER BY created_at, id LOOP
    UPDATE movies SET slug_cs = slug_cs, slug_en = slug_en WHERE id = r.id;
  END LOOP;
END;
$$;

ALTER TABLE movies ALTER COLUMN slug_cs SET NOT NULL;
ALTER TABLE movies ALTER COLUMN slug_en SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_edition_slug_cs ON movies(edition_id, slug_cs);
CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_edition_slug_en ON movies(edition_id, slug_en);

COMMENT ON COLUMN movies.slug_cs IS 'URL slug on irmf.cz: /katalog/<edition year>/<slug_cs>/ (unique per edition)';
COMMENT ON COLUMN movies.slug_en IS 'URL slug on irmf.net: /catalogue/<edition year>/<slug_en>/ (unique per edition)';
