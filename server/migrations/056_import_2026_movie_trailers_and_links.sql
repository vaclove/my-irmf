-- Migration: Import trailers and links for the 2026 selection
-- Source: FilmFreeway project pages of the selected films, extracted 2026-10-06
-- (filmy-odkazy.json). Only fills empty fields, so anything entered by hand in
-- the admin is never overwritten, and re-running is harmless.
--
-- Not imported:
--   * three trailers exist only as MP4 files (Vedistan, Get Lost Luca, The Big Ride);
--     add the URL in the admin once they are uploaded to YouTube/Vimeo;
--   * Untamed lists a second YouTube video as its "Website"; left out as it is not a website;
--   * The Quest for Emerald Mountain, Pierced Souls, The Kingdom of the Innocents had no links.

WITH links (movie_id, trailer_url, website_url, facebook_url, instagram_url) AS (
  VALUES
    -- Untamed
    ('69f675aa-e92b-473c-bdbc-42dd5a99051f'::uuid, 'https://www.youtube.com/watch?v=lLj0iIIFAa4', NULL, NULL, 'https://www.instagram.com/fabiominnig/'),
    -- Life Is
    ('cdc47f24-8a7d-4c39-ab28-326ff51346e5'::uuid, 'https://www.youtube.com/watch?v=5Vr5yAG11TQ', 'https://www.tulip-pictures.com/pelicula/la-vida-es', 'https://www.facebook.com/LaVidaEsFilm', 'https://www.instagram.com/lavidaes_film/'),
    -- Lost Down Mexico Way
    ('0fd618b0-ed71-409a-9935-eafda8533e1f'::uuid, 'https://vimeo.com/1174371368', NULL, NULL, NULL),
    -- Felicia on the Road
    ('84174c9e-0fb6-4397-8115-68251604a178'::uuid, 'https://www.youtube.com/watch?v=zH1jjJW_4ps', 'https://felicienacestach.cz/', NULL, 'https://www.instagram.com/felicie_na_cestach/'),
    -- Get Lost, Luca (trailer pending upload)
    ('142bf96d-3469-4902-818f-8cd5811a6b0e'::uuid, NULL, NULL, NULL, 'https://www.instagram.com/fzhl_official/'),
    -- Adrift on the Amazon
    ('d09e0bfb-7afb-4afb-a14d-570fc8d03f78'::uuid, 'https://vimeo.com/1094159887', NULL, NULL, 'https://www.instagram.com/fotemelcram/'),
    -- The Big Ride (trailer pending upload)
    ('9a5e6728-64f2-424f-b7a6-62f4b0c616c0'::uuid, NULL, NULL, 'https://www.facebook.com/severine.destreyker', 'https://www.instagram.com/severine_day/'),
    -- Our Solar System
    ('c551c295-59d5-4692-a0c7-4f824e4f7697'::uuid, 'https://vimeo.com/1019217484', 'http://oursolarsystemfilm.com/', NULL, 'https://instagram.com/oursolarsystemfilm'),
    -- A Woman of Roses (Emraa Min Ward)
    ('853103ad-f20c-4970-bf19-7532426f51d6'::uuid, NULL, 'http://www.ameel.me/', NULL, NULL),
    -- Congo: The Price of an Elephant
    ('a6fb0670-8844-41fd-a494-c83dc4075de0'::uuid, 'https://www.youtube.com/watch?v=Gm4R5z66YaE', 'http://www.kongocenaslona.cz/', 'https://www.facebook.com/kongocenaslona', 'https://www.instagram.com/kongocenaslona/')
)
UPDATE movies m SET
  trailer_url   = COALESCE(NULLIF(m.trailer_url, ''), l.trailer_url),
  website_url   = COALESCE(NULLIF(m.website_url, ''), l.website_url),
  facebook_url  = COALESCE(NULLIF(m.facebook_url, ''), l.facebook_url),
  instagram_url = COALESCE(NULLIF(m.instagram_url, ''), l.instagram_url)
FROM links l
WHERE m.id = l.movie_id;

-- Two films are not in the public 2026 catalogue (missing or not public), so their
-- ids are unknown here: match them by title within the 2026 edition. No-op if absent.
UPDATE movies m SET
  website_url   = COALESCE(NULLIF(m.website_url, ''), 'https://austintrapnell.wixsite.com/portfolio/single-project-1'),
  instagram_url = COALESCE(NULLIF(m.instagram_url, ''), 'https://www.instagram.com/austin_trapnell/')
FROM editions e
WHERE m.edition_id = e.id AND e.year = 2026
  AND (m.name_en ILIKE 'Socotra%' OR m.name_cs ILIKE 'Socotra%');

UPDATE movies m SET
  facebook_url  = COALESCE(NULLIF(m.facebook_url, ''), 'https://facebook.com/vedmalmo'),
  instagram_url = COALESCE(NULLIF(m.instagram_url, ''), 'https://instagram.com/ved.sound')
FROM editions e
WHERE m.edition_id = e.id AND e.year = 2026
  AND (m.name_en ILIKE 'Vedistan%' OR m.name_cs ILIKE 'Vedistan%');
