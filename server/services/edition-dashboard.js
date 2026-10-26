const { pool } = require('../models/database');
const { getEditionPresale, pragueDate, dayOffset } = require('./goout-presale');
const { getSummary: getBoxOfficeSummary } = require('./box-office');

/**
 * Management dashboard of an edition (Tickets → Dashboard): every ticketing
 * channel and the door on one page.
 *
 * - GoOut presale: tickets and passes bought online, from goout-presale.js
 *   (cached there: 5 minutes for running sales, 12 hours for ended ones). When
 *   GoOut is unavailable the dashboard still shows the box office and the door,
 *   with `goout` null and the reason in `errors`.
 * - Box office: tickets sold at the venue (box_office_tickets), cancelled ones
 *   left out.
 * - Head counts: screening_attendance, admissions entered by hand for screenings
 *   nobody scans (school screenings, free events); added to the door scans
 * - Attendance: badge_scans, one row per admission, by entry type:
 *     ticket     GoOut ticket (checked in at GoOut, or unverified when GoOut did not answer)
 *     pass       GoOut festival pass
 *     boxOffice  box-office ticket
 *     badge      our badge (guests, crew, passes converted to accreditations)
 *     other      one-time tickets and external badges
 *
 * Screenings are grouped by their day (programming_schedule.scheduled_date), not
 * by the day of sale: the presale page already shows sales over time. Show-up
 * is ticket-holder admissions (GoOut and box-office ticket scans) against sold
 * tickets; pass and badge holders don't buy tickets, so they're not in it.
 */

const SCAN_TYPE = `
  CASE
    WHEN bs.goout_status IN ('checked_in', 'unverified') THEN 'ticket'
    WHEN bs.goout_status = 'pass' THEN 'pass'
    WHEN bs.goout_status = 'box_office' THEN 'boxOffice'
    WHEN bs.guest_id IS NOT NULL THEN 'badge'
    ELSE 'other'
  END`;

const SCAN_TYPES = ['ticket', 'pass', 'boxOffice', 'badge', 'other', 'manual'];

class DashboardError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const emptyScans = () => Object.fromEntries([...SCAN_TYPES, 'total'].map(t => [t, 0]));
const emptyBoxOffice = () => ({ sold: 0, paid: 0, free: 0, cashCents: 0, cardCents: 0, revenueCents: 0 });

const addInto = (target, source) => {
  for (const key of Object.keys(target)) target[key] += source?.[key] || 0;
};

async function loadEdition(editionId) {
  const { rows } = await pool.query(`
    SELECT e.id, e.year, e.name, e.start_date::text AS start_date, e.end_date::text AS end_date,
           (SELECT MIN(ps.scheduled_date)::text FROM programming_schedule ps WHERE ps.edition_id = e.id) AS first_day,
           (SELECT MAX(ps.scheduled_date)::text FROM programming_schedule ps WHERE ps.edition_id = e.id) AS last_day
    FROM editions e WHERE e.id = $1
  `, [editionId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    year: row.year,
    name: row.name,
    startDate: row.start_date || row.first_day,
    endDate: row.end_date || row.last_day
  };
}

// Timed programme entries with their box-office tickets and admissions. Hidden entries
// stay in, so the totals match the Presale tab and the box-office cash-up.
async function loadScreenings(editionId) {
  const { rows } = await pool.query(`
    SELECT
      ps.id,
      ps.scheduled_date::text AS date,
      to_char(ps.scheduled_time, 'HH24:MI') AS time,
      COALESCE(NULLIF(ps.title_override_cs, ''), m.name_cs, mb.name_cs) AS title,
      v.name_cs AS venue,
      COALESCE(ps.ticket_capacity, v.capacity) AS capacity,
      ps.free_entry,
      ps.hidden_from_public IS TRUE AS hidden,
      ps.goout_schedule_id IS NOT NULL AS goout_linked,
      ((ps.scheduled_date + ps.scheduled_time) AT TIME ZONE 'Europe/Prague') <= now() AS started,
      ((ps.scheduled_date + ps.scheduled_time) AT TIME ZONE 'Europe/Prague')
        + (COALESCE(ps.total_runtime, 0) || ' minutes')::interval < now() AS ended,
      (SELECT json_build_object(
          'sold', COUNT(*),
          'paid', COUNT(*) FILTER (WHERE t.payment_method <> 'free'),
          'free', COUNT(*) FILTER (WHERE t.payment_method = 'free'),
          'cashCents', COALESCE(SUM(t.price_cents) FILTER (WHERE t.payment_method = 'cash'), 0),
          'cardCents', COALESCE(SUM(t.price_cents) FILTER (WHERE t.payment_method = 'card'), 0),
          'revenueCents', COALESCE(SUM(t.price_cents), 0))
        FROM box_office_tickets t
        WHERE t.programming_id = ps.id AND t.cancelled_at IS NULL) AS box_office,
      (SELECT json_build_object(
          'total', COUNT(*),
          'ticket', COUNT(*) FILTER (WHERE ${SCAN_TYPE} = 'ticket'),
          'pass', COUNT(*) FILTER (WHERE ${SCAN_TYPE} = 'pass'),
          'boxOffice', COUNT(*) FILTER (WHERE ${SCAN_TYPE} = 'boxOffice'),
          'badge', COUNT(*) FILTER (WHERE ${SCAN_TYPE} = 'badge'),
          'other', COUNT(*) FILTER (WHERE ${SCAN_TYPE} = 'other'))
        FROM badge_scans bs
        WHERE bs.programming_id = ps.id) AS scans,
      (SELECT json_build_object(
          'count', sa.count, 'note', sa.note, 'enteredBy', sa.entered_by, 'enteredAt', sa.entered_at)
        FROM screening_attendance sa
        WHERE sa.programming_id = ps.id) AS manual
    FROM programming_schedule ps
    JOIN venues v ON v.id = ps.venue_id
    LEFT JOIN movies m ON m.id = ps.movie_id
    LEFT JOIN movie_blocks mb ON mb.id = ps.block_id
    WHERE ps.edition_id = $1
      AND ps.scheduled_time IS NOT NULL
    ORDER BY ps.scheduled_date, ps.scheduled_time, v.sort_order
  `, [editionId]);
  return rows;
}

// Box office by day of sale (today's takings) and the latest sale and scan, as liveness cues
async function loadActivity(editionId) {
  const { rows } = await pool.query(`
    SELECT
      (SELECT MAX(t.sold_at) FROM box_office_tickets t
         JOIN programming_schedule ps ON ps.id = t.programming_id
         WHERE ps.edition_id = $1 AND t.cancelled_at IS NULL) AS last_sale_at,
      (SELECT MAX(bs.scanned_at AT TIME ZONE 'Europe/Prague') FROM badge_scans bs
         JOIN programming_schedule ps ON ps.id = bs.programming_id
         WHERE ps.edition_id = $1) AS last_scan_at,
      (SELECT COUNT(*) FROM goout_accreditations a WHERE a.edition_id = $1)::int AS converted_passes
  `, [editionId]);
  return rows[0];
}

// Final numbers of the edition a year earlier, for the "last year" lines of the tiles
async function loadPreviousEdition(year) {
  const { rows } = await pool.query(`
    SELECT e.id, e.year,
      (SELECT COUNT(*) FROM box_office_tickets t
         JOIN programming_schedule ps ON ps.id = t.programming_id
         WHERE ps.edition_id = e.id AND t.cancelled_at IS NULL)::int AS box_office_tickets,
      (SELECT COALESCE(SUM(t.price_cents), 0) FROM box_office_tickets t
         JOIN programming_schedule ps ON ps.id = t.programming_id
         WHERE ps.edition_id = e.id AND t.cancelled_at IS NULL)::int AS box_office_revenue_cents,
      (SELECT COUNT(*) FROM badge_scans bs
         JOIN programming_schedule ps ON ps.id = bs.programming_id
         WHERE ps.edition_id = e.id)::int AS admissions
    FROM editions e WHERE e.year = $1
  `, [year - 1]);
  const row = rows[0];
  if (!row) return null;
  return {
    year: row.year,
    boxOffice: { tickets: row.box_office_tickets, revenueCents: row.box_office_revenue_cents },
    admissions: row.admissions
  };
}

// GoOut presale, or null with the reason when GoOut can't be read
async function loadPresale(editionId, refresh, errors) {
  try {
    const presale = await getEditionPresale(editionId, { refresh });
    if (!presale || presale.empty) return null;
    for (const e of presale.errors || []) errors.push(e.error);
    return presale;
  } catch (error) {
    errors.push(`GoOut presale unavailable: ${error.message}`);
    return null;
  }
}

/**
 * The dashboard of an edition.
 * @param {string} editionId
 * @param {boolean} refresh - reload running GoOut sales instead of the 5-minute cache
 */
async function getEditionDashboard(editionId, { refresh = false } = {}) {
  const edition = await loadEdition(editionId);
  if (!edition) return null;

  const errors = [];
  const [presale, rows, activity, previous] = await Promise.all([
    loadPresale(editionId, refresh, errors),
    loadScreenings(editionId),
    loadActivity(editionId),
    loadPreviousEdition(edition.year).catch(error => {
      errors.push(`Previous edition: ${error.message}`);
      return null;
    })
  ]);

  const gooutByScreening = new Map((presale?.screenings || []).map(s => [s.programmingId, s]));

  const screenings = rows.map(row => {
    const goout = gooutByScreening.get(row.id);
    const boxOffice = { ...emptyBoxOffice(), ...row.box_office };
    const scans = { ...emptyScans(), ...row.scans };
    // A head count entered by hand joins the door scans, but is not tied to tickets
    if (row.manual) {
      scans.manual = row.manual.count;
      scans.total += row.manual.count;
    }
    const sold = (goout?.sold || 0) + boxOffice.sold;
    const paid = (goout?.paid || 0) + boxOffice.paid;
    const revenueCents = (goout?.revenueCents || 0) + boxOffice.revenueCents;
    const ticketHolders = scans.ticket + scans.boxOffice;
    // Show-up needs every channel's sales: without GoOut data a linked screening has none
    const soldKnown = !row.goout_linked || !!goout;
    return {
      programmingId: row.id,
      date: row.date,
      time: row.time,
      title: row.title,
      venue: row.venue,
      capacity: row.capacity,
      freeEntry: row.free_entry,
      hidden: row.hidden,
      gooutLinked: row.goout_linked,
      started: row.started,
      ended: row.ended,
      goout: goout
        ? { sold: goout.sold, paid: goout.paid, free: goout.free, revenueCents: goout.revenueCents, saleState: goout.saleState }
        : null,
      boxOffice,
      scans,
      manual: row.manual,
      sold,
      paid,
      free: sold - paid,
      revenueCents,
      occupancy: row.capacity && !row.free_entry ? sold / row.capacity : null,
      // Only once the doors have opened does a missing scan mean a no-show
      showUp: row.started && soldKnown && sold ? ticketHolders / sold : null,
      soldKnown
    };
  });

  // Festival days: one bucket per screening date
  const days = [];
  for (const s of screenings) {
    let day = days[days.length - 1];
    if (day?.date !== s.date) {
      day = {
        date: s.date,
        day: edition.startDate ? dayOffset(s.date, edition.startDate) : null,
        screenings: 0, capacity: 0,
        sold: 0, gooutSold: 0, boxOfficeSold: 0,
        revenueCents: 0, gooutRevenueCents: 0, boxOfficeRevenueCents: 0,
        scans: emptyScans()
      };
      days.push(day);
    }
    day.screenings++;
    if (!s.freeEntry) day.capacity += s.capacity || 0;
    day.sold += s.sold;
    day.gooutSold += s.goout?.sold || 0;
    day.boxOfficeSold += s.boxOffice.sold;
    day.revenueCents += s.revenueCents;
    day.gooutRevenueCents += s.goout?.revenueCents || 0;
    day.boxOfficeRevenueCents += s.boxOffice.revenueCents;
    addInto(day.scans, s.scans);
  }

  // Totals across channels
  const boxOffice = emptyBoxOffice();
  const scans = emptyScans();
  for (const s of screenings) {
    addInto(boxOffice, s.boxOffice);
    addInto(scans, s.scans);
  }

  const ticketed = screenings.filter(s => !s.freeEntry && s.capacity);
  const capacity = ticketed.reduce((sum, s) => sum + s.capacity, 0);
  const started = screenings.filter(s => s.started && s.soldKnown);
  const startedSold = started.reduce((sum, s) => sum + s.sold, 0);
  const startedHolders = started.reduce((sum, s) => sum + s.scans.ticket + s.scans.boxOffice, 0);

  const gooutTotals = presale?.totals;
  const todayPrague = pragueDate(new Date().toISOString());
  const todayBoxOffice = (await getBoxOfficeSummary(editionId))
    .filter(r => r.day === todayPrague)
    .reduce((acc, r) => ({
      tickets: acc.tickets + r.tickets,
      revenueCents: acc.revenueCents + (r.payment_method === 'free' ? 0 : r.revenue_cents)
    }), { tickets: 0, revenueCents: 0 });

  const totals = {
    revenue: {
      gooutTicketsCents: gooutTotals?.revenueCents || 0,
      gooutPassesCents: gooutTotals?.passRevenueCents || 0,
      boxOfficeCashCents: boxOffice.cashCents,
      boxOfficeCardCents: boxOffice.cardCents,
      totalCents: (gooutTotals?.totalRevenueCents || 0) + boxOffice.revenueCents
    },
    tickets: {
      goout: { paid: gooutTotals?.paidTickets || 0, free: gooutTotals?.freeTickets || 0, last24h: gooutTotals?.last24h || 0 },
      boxOffice: { paid: boxOffice.paid, free: boxOffice.free, today: todayBoxOffice },
      paid: (gooutTotals?.paidTickets || 0) + boxOffice.paid,
      free: (gooutTotals?.freeTickets || 0) + boxOffice.free
    },
    passes: {
      paid: gooutTotals?.passes || 0,
      free: gooutTotals?.freePasses || 0,
      converted: activity.converted_passes
    },
    attendance: {
      ...scans,
      showUp: startedSold ? startedHolders / startedSold : null,
      startedScreenings: started.length
    },
    occupancy: capacity ? ticketed.reduce((sum, s) => sum + s.sold, 0) / capacity : null,
    capacity,
    screenings: screenings.length,
    soldOut: gooutTotals?.soldOut || 0
  };

  const todayOffset = edition.startDate ? dayOffset(todayPrague, edition.startDate) : null;
  const festivalLength = edition.startDate ? dayOffset(edition.endDate || edition.startDate, edition.startDate) : null;

  return {
    edition,
    today: todayOffset !== null && todayOffset <= festivalLength ? todayOffset : null,
    festivalLength,
    goout: presale ? {
      updatedAt: presale.updatedAt,
      comparison: presale.comparison
        ? { year: presale.comparison.year, atSamePoint: presale.comparison.atSamePoint, final: presale.comparison.final }
        : null
    } : null,
    previous,
    totals,
    days,
    screenings,
    activity: {
      lastSaleAt: activity.last_sale_at,
      lastScanAt: activity.last_scan_at
    },
    errors,
    updatedAt: new Date().toISOString()
  };
}

// Head count for a screening, entered by hand (replaces an earlier one)
async function setManualAttendance(programmingId, { count, note }, enteredBy) {
  const people = Number(count);
  if (!Number.isInteger(people) || people < 0 || people > 100000) {
    throw new DashboardError(400, 'The head count must be a whole number between 0 and 100 000');
  }
  const text = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  try {
    const { rows } = await pool.query(`
      INSERT INTO screening_attendance (programming_id, count, note, entered_by)
      VALUES ($1, $2, NULLIF($3, ''), $4)
      ON CONFLICT (programming_id) DO UPDATE
        SET count = EXCLUDED.count, note = EXCLUDED.note, entered_by = EXCLUDED.entered_by, entered_at = now()
      RETURNING programming_id, count, note, entered_by, entered_at`,
      [programmingId, people, text, enteredBy || null]);
    return rows[0];
  } catch (error) {
    if (error.code === '23503') throw new DashboardError(404, 'Screening not found');
    throw error;
  }
}

async function clearManualAttendance(programmingId) {
  const { rowCount } = await pool.query('DELETE FROM screening_attendance WHERE programming_id = $1', [programmingId]);
  return rowCount > 0;
}

module.exports = { getEditionDashboard, setManualAttendance, clearManualAttendance, DashboardError };
