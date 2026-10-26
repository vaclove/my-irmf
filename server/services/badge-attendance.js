const { pool } = require('../models/database');

/**
 * Tickets → Badges: how often badge holders came to screenings, person by person.
 *
 * Population: everyone with the edition's year tag, a badge number for the
 * edition, or a badge scan at one of its screenings. The category comes from the
 * guest's tags with the priority used elsewhere in the app (filmmaker, press,
 * staff, guest, public); a guest without a category tag counts as "guest".
 * Converted GoOut passes carry the "public" tag, so they form the "sold
 * accreditations" group.
 *
 * A scan counts once per person and screening (badge_scans is unique on that
 * pair), so visits = screenings attended. Free-entry events are counted
 * separately so the page can leave them out.
 */

const CATEGORIES = ['filmmaker', 'press', 'guest', 'staff', 'public'];

async function loadEdition(editionId) {
  const { rows: [row] } = await pool.query(
    'SELECT id, year, name, start_date::text AS start_date, end_date::text AS end_date FROM editions WHERE id = $1',
    [editionId]
  );
  return row || null;
}

async function loadScreeningCounts(editionId) {
  const { rows: [row] } = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE free_entry)::int AS free_entry,
           COUNT(*) FILTER (WHERE (scheduled_date + scheduled_time) AT TIME ZONE 'Europe/Prague' <= now())::int AS started
    FROM programming_schedule
    WHERE edition_id = $1 AND scheduled_time IS NOT NULL`, [editionId]);
  return row;
}

async function loadPeople(editionId, year) {
  const { rows } = await pool.query(`
    SELECT
      g.id,
      g.first_name,
      g.last_name,
      g.company,
      COALESCE(
        (SELECT t.name
         FROM guest_tags gt JOIN tags t ON t.id = gt.tag_id
         WHERE gt.guest_id = g.id AND t.name = ANY($3)
         ORDER BY CASE t.name
           WHEN 'filmmaker' THEN 1 WHEN 'press' THEN 2 WHEN 'staff' THEN 3 WHEN 'guest' THEN 4 ELSE 5 END
         LIMIT 1),
        'guest') AS category,
      gbn.badge_number,
      EXISTS (SELECT 1 FROM goout_accreditations ga WHERE ga.guest_id = g.id AND ga.edition_id = $1) AS converted_pass,
      s.visits,
      s.ticketed_visits,
      s.days,
      s.first_scan,
      s.last_scan
    FROM guests g
    LEFT JOIN guest_badge_numbers gbn ON gbn.guest_id = g.id AND gbn.edition_id = $1
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS visits,
             COUNT(*) FILTER (WHERE NOT COALESCE(ps.free_entry, false))::int AS ticketed_visits,
             COUNT(DISTINCT ps.scheduled_date)::int AS days,
             MIN(bs.scanned_at AT TIME ZONE 'Europe/Prague') AS first_scan,
             MAX(bs.scanned_at AT TIME ZONE 'Europe/Prague') AS last_scan
      FROM badge_scans bs
      JOIN programming_schedule ps ON ps.id = bs.programming_id
      WHERE bs.guest_id = g.id AND ps.edition_id = $1
    ) s ON true
    WHERE gbn.id IS NOT NULL
       OR s.visits > 0
       OR EXISTS (SELECT 1 FROM guest_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.guest_id = g.id AND t.name = $2)
    ORDER BY s.visits DESC, g.last_name, g.first_name`,
    [editionId, String(year), CATEGORIES]);

  return rows.map(row => ({
    guestId: row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(' '),
    company: row.company || null,
    category: row.category,
    badgeNumber: row.badge_number,
    convertedPass: row.converted_pass,
    visits: row.visits,
    ticketedVisits: row.ticketed_visits,
    days: row.days,
    firstScan: row.first_scan,
    lastScan: row.last_scan
  }));
}

async function getBadgeAttendance(editionId) {
  const edition = await loadEdition(editionId);
  if (!edition) return null;
  const [people, screenings] = await Promise.all([
    loadPeople(editionId, edition.year),
    loadScreeningCounts(editionId)
  ]);
  return {
    edition: { id: edition.id, year: edition.year, name: edition.name, startDate: edition.start_date, endDate: edition.end_date },
    categories: CATEGORIES,
    screenings,
    people,
    updatedAt: new Date().toISOString()
  };
}

module.exports = { getBadgeAttendance, CATEGORIES };
