require('dotenv').config();
const { pool } = require('../models/database');
const goOutAPI = require('../services/goout-api');

/**
 * Sync GoOut IDs into an edition's programme.
 *
 *   node server/scripts/goout-sync-edition.js [--year 2026] [--apply] [--overwrite]
 *
 * - Reads all IRMF sales from GoOut, keeps those whose schedule starts in the edition year.
 * - The festival pass (schedule without a start time) is linked to a hidden
 *   "Akreditace festivalu" programming entry, which is created if missing.
 * - Every other schedule is matched to a programming entry by date + start time (Europe/Prague),
 *   unless an entry is already linked to it, and gets goout_schedule_id + goout_checkin_id.
 * - Dry run by default. --apply writes in one transaction. --overwrite replaces IDs that differ.
 */

const GOOUT_ORGANIZER_ID = '8736'; // International Road Movie Festival
const ACCREDITATION_VENUE = 'Malý sál';
const ACCREDITATION_TIME = '12:00';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OVERWRITE = args.includes('--overwrite');
const yearArg = args.indexOf('--year');
const YEAR = yearArg >= 0 ? parseInt(args[yearArg + 1], 10) : new Date().getFullYear();

function pragueDateTime(iso) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(iso)).map(p => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

async function fetchByIds(path, ids) {
  const items = [];
  for (let i = 0; i < ids.length; i += 48) {
    const response = await goOutAPI.apiRequest('GET', path, null, {
      'ids[]': ids.slice(i, i + 48),
      'languages[]': ['cs']
    });
    items.push(...(response.data || []));
  }
  return Object.fromEntries(items.map(item => [item.id, item]));
}

async function loadGoOutSchedules() {
  const { data: sales } = await goOutAPI.getAllSales('', 20);
  const ourSales = sales.filter(sale =>
    sale.relationships?.organizer?.data?.id === GOOUT_ORGANIZER_ID &&
    sale.attributes?.state !== 'cancelled' &&
    sale.relationships?.schedule?.data?.id
  );

  const scheduleIds = [...new Set(ourSales.map(sale => sale.relationships.schedule.data.id))];
  const schedules = await fetchByIds('/services/entities/v2/schedules', scheduleIds);
  const eventIds = [...new Set(Object.values(schedules).map(s => s.relationships?.event?.data?.id).filter(Boolean))];
  const events = await fetchByIds('/services/entities/v2/events', eventIds);

  const result = [];
  for (const scheduleId of scheduleIds) {
    const schedule = schedules[scheduleId];
    if (!schedule?.attributes?.startAt) continue;
    const { date, time } = pragueDateTime(schedule.attributes.startAt);
    if (!date.startsWith(`${YEAR}-`)) continue;

    const scheduleSales = ourSales.filter(sale => sale.relationships.schedule.data.id === scheduleId);
    const checkinIds = [...new Set(scheduleSales.flatMap(sale => (sale.relationships.checkIns?.data || []).map(c => c.id)))];
    const event = events[schedule.relationships?.event?.data?.id];

    result.push({
      scheduleId,
      checkinId: checkinIds[0] || null,
      extraCheckinIds: checkinIds.slice(1),
      saleIds: scheduleSales.map(sale => sale.id),
      state: schedule.attributes.ticketingState,
      isFestivalPass: schedule.attributes.hasTime === false,
      date,
      time,
      name: event?.attributes?.locales?.cs?.name || event?.attributes?.locales?.en?.name || '?',
      url: schedule.attributes.locales?.cs?.siteUrl || null
    });
  }
  return result.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

async function loadProgramme(client, editionId) {
  const { rows } = await client.query(`
    SELECT ps.id, ps.scheduled_date::text AS date, to_char(ps.scheduled_time, 'HH24:MI') AS time,
           ps.hidden_from_public, ps.goout_schedule_id, ps.goout_checkin_id, v.name_cs AS venue,
           COALESCE(NULLIF(ps.title_override_cs, ''), m.name_cs, b.name_cs) AS title
    FROM programming_schedule ps
    JOIN venues v ON v.id = ps.venue_id
    LEFT JOIN movies m ON m.id = ps.movie_id
    LEFT JOIN movie_blocks b ON b.id = ps.block_id
    WHERE ps.edition_id = $1
    ORDER BY ps.scheduled_date, ps.scheduled_time
  `, [editionId]);
  return rows;
}

async function ensureAccreditationEntry(client, edition, pass, programme) {
  const existing = programme.find(p => p.goout_schedule_id === pass.scheduleId) ||
    programme.find(p => p.title === 'Akreditace festivalu');
  if (existing) return existing;

  console.log(`+ create hidden "Akreditace festivalu" entry: ${pass.date} ${ACCREDITATION_TIME} ${ACCREDITATION_VENUE}`);
  if (!APPLY) return null;

  const venue = await client.query('SELECT id FROM venues WHERE name_cs = $1', [ACCREDITATION_VENUE]);
  if (venue.rowCount !== 1) throw new Error(`Venue "${ACCREDITATION_VENUE}" not found`);

  const movie = await client.query(`
    INSERT INTO movies (edition_id, name_cs, name_en, synopsis_cs, synopsis_en, runtime, director, year, country, is_public, is_35mm, has_delegation)
    VALUES ($1, 'Akreditace festivalu', 'Festival Accreditation',
            'Vyzvednutí akreditací a festivalových materiálů', 'Accreditation and festival materials pickup',
            '0', 'IRMF', $2, 'Česká republika', false, false, false)
    RETURNING id
  `, [edition.id, YEAR]);

  const entry = await client.query(`
    INSERT INTO programming_schedule (edition_id, venue_id, movie_id, scheduled_date, scheduled_time,
                                      base_runtime, discussion_time, total_runtime, notes, ticket_link, hidden_from_public)
    VALUES ($1, $2, $3, $4, $5, 0, 0, 0,
            'Vyzvednutí festivalových akreditací a materiálů / Festival accreditation and materials pickup', $6, true)
    RETURNING id
  `, [edition.id, venue.rows[0].id, movie.rows[0].id, pass.date, ACCREDITATION_TIME, pass.url]);

  return { id: entry.rows[0].id, title: 'Akreditace festivalu', goout_schedule_id: null, goout_checkin_id: null };
}

async function main() {
  console.log(`GoOut sync for edition ${YEAR} (${APPLY ? 'APPLY' : 'dry run'}${OVERWRITE ? ', overwrite' : ''})\n`);

  const client = await pool.connect();
  try {
    const editionResult = await client.query('SELECT id, year FROM editions WHERE year = $1', [YEAR]);
    if (editionResult.rowCount !== 1) throw new Error(`Edition ${YEAR} not found`);
    const edition = editionResult.rows[0];

    const gooutSchedules = await loadGoOutSchedules();
    const programme = await loadProgramme(client, edition.id);
    console.log(`GoOut: ${gooutSchedules.length} schedules in ${YEAR}, programme: ${programme.length} entries\n`);

    const passes = gooutSchedules.filter(s => s.isFestivalPass);
    const screenings = gooutSchedules.filter(s => !s.isFestivalPass);
    if (passes.length > 1) throw new Error(`Expected at most one festival pass, found ${passes.length}`);

    await client.query('BEGIN');

    // Pair GoOut schedules with programming entries
    const pairs = [];
    const unmatched = [];
    if (passes[0]) {
      const entry = await ensureAccreditationEntry(client, edition, passes[0], programme);
      if (entry) pairs.push({ goout: passes[0], entry });
    }
    for (const goout of screenings) {
      // An existing link wins (it may have been fixed by hand, e.g. after a time change)
      const linkedEntry = programme.find(p => p.goout_schedule_id === goout.scheduleId);
      if (linkedEntry) { pairs.push({ goout, entry: linkedEntry }); continue; }

      const candidates = programme.filter(p => p.date === goout.date && p.time === goout.time);
      const visible = candidates.filter(p => !p.hidden_from_public);
      const pick = candidates.length === 1 ? candidates : visible;
      if (pick.length === 1) pairs.push({ goout, entry: pick[0] });
      else unmatched.push({ goout, reason: candidates.length ? `${candidates.length} entries at that time` : 'no entry at that time' });
    }

    let updated = 0;
    for (const { goout, entry } of pairs) {
      const label = `${goout.date} ${goout.time} ${goout.name} -> ${entry.title}`;
      if (!goout.checkinId) console.log(`! ${label}: GoOut sale has no check-in`);
      if (goout.extraCheckinIds.length) console.log(`! ${label}: extra check-ins ${goout.extraCheckinIds.join(', ')} ignored`);

      const same = entry.goout_schedule_id === goout.scheduleId && entry.goout_checkin_id === goout.checkinId;
      const empty = !entry.goout_schedule_id && !entry.goout_checkin_id;
      if (same) { console.log(`= ${label}`); continue; }
      if (!empty && !OVERWRITE) {
        console.log(`! ${label}: has ${entry.goout_schedule_id}/${entry.goout_checkin_id}, GoOut says ${goout.scheduleId}/${goout.checkinId} (use --overwrite)`);
        continue;
      }

      console.log(`~ ${label}: schedule ${goout.scheduleId}, check-in ${goout.checkinId}`);
      const result = await client.query(
        `UPDATE programming_schedule
         SET goout_schedule_id = $2, goout_checkin_id = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND goout_schedule_id IS NOT DISTINCT FROM $4 AND goout_checkin_id IS NOT DISTINCT FROM $5`,
        [entry.id, goout.scheduleId, goout.checkinId, entry.goout_schedule_id, entry.goout_checkin_id]
      );
      if (result.rowCount !== 1) throw new Error(`Entry ${entry.id} changed concurrently, aborting`);
      updated++;
    }

    for (const { goout, reason } of unmatched) {
      console.log(`? GoOut ${goout.date} ${goout.time} ${goout.name} (schedule ${goout.scheduleId}): ${reason}`);
    }
    const linked = new Set(pairs.map(p => p.entry.id));
    for (const entry of programme) {
      if (!linked.has(entry.id) && !entry.goout_schedule_id) {
        console.log(`- programme ${entry.date} ${entry.time} ${entry.venue} ${entry.title || ''}${entry.hidden_from_public ? ' (hidden)' : ''}: not on GoOut`);
      }
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\nApplied: ${updated} entries updated.`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\nDry run: ${updated} entries would be updated. Re-run with --apply.`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('GoOut sync failed:', error.response?.data || error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
