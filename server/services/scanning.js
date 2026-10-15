const { pool } = require('../models/database');
const { isValidTicketCode } = require('../utils/luhn');
const { isGoOutTicketCode, verifyGoOutTicket } = require('./goout-ticket-verifier');

/**
 * Scanning shared by the staff scanner (routes/scanner.js) and phones that joined
 * through a scanner link (routes/scanner-session.js).
 */

// badge_scans.scanned_at is a timestamp without time zone holding Prague time (the DB
// session runs in Europe/Prague), while Node runs in UTC. Queries read it with
// AT TIME ZONE 'Europe/Prague' so clients get the right instant.

const GOOUT_TICKET_TYPES = {
  checked_in: 'GoOut ticket',
  pass: 'Festival pass',
  unverified: 'GoOut ticket (unverified)'
};

// Name shown for a scan without a guest record. GoOut tickets show the name
// on the ticket when GoOut returned it, with the ticket type as category.
function scanLabel(badgeNumber, gooutStatus, holderName) {
  const code = String(badgeNumber);
  if (code.length === 7 && code.startsWith('30')) {
    return { firstName: 'One-time', lastName: 'Ticket' };
  }

  const ticketType = GOOUT_TICKET_TYPES[gooutStatus];
  if (!ticketType) {
    return { firstName: 'External', lastName: 'Guest' };
  }
  return holderName
    ? { firstName: holderName, lastName: '', category: ticketType }
    : { firstName: ticketType, lastName: '' };
}

/**
 * Check a scanned code against a screening and record the scan.
 * @param {object} scan
 * @param {string} scan.programming_id - screening
 * @param {string} scan.scanned_code - badge, one-time ticket or GoOut ticket code
 * @param {string} scan.scannedBy - who scanned (staff email, or phone operator name)
 * @param {string|null} [scan.scannerDeviceId] - phone that scanned
 * @returns {Promise<{status: number, body: object}>} HTTP status and response body
 */
async function processScan({ programming_id, scanned_code, scannedBy, scannerDeviceId = null }) {
  if (!programming_id || !scanned_code) {
    return { status: 400, body: { error: 'programming_id and scanned_code are required' } };
  }

  // Extract badge information based on scanned code format
  // Internal badge: YYYY### (length 7, not starting with 30) - e.g., 2025003
  // One-time ticket: 30XXXXC (length 7, starts with 30) - e.g., 3012347
  // GoOut ticket: 13 digits with an EAN-13 check digit - e.g., 1400528549781
  // Anything else is rejected (usually a misread)

  const scannedStr = String(scanned_code);
  let badgeNumber = null;
  let isInternalBadge = false;
  let isOneTimeTicket = false;
  let isGoOutTicket = false;

  if (scannedStr.length === 7) {
    if (scannedStr.startsWith('30')) {
      // One-time ticket - validate using Luhn algorithm
      if (!isValidTicketCode(scannedStr)) {
        return { status: 400, body: { error: 'Invalid ticket code' } };
      }
      isOneTimeTicket = true;
    } else {
      // Our internal badge format: extract last 3 digits
      badgeNumber = parseInt(scannedStr.slice(-3));
      isInternalBadge = !isNaN(badgeNumber);
    }
  } else if (isGoOutTicketCode(scannedStr)) {
    isGoOutTicket = true;
  } else {
    return { status: 400, body: { error: 'Unknown code' } };
  }

  const badgeIdentifier = isInternalBadge ? badgeNumber : scannedStr;

  let guest = null;
  let guestId = null;

  if (isInternalBadge) {
    // Look up internal guest by badge number within the screening's edition.
    // Badge numbers restart every edition, so the YYYY prefix must match too.
    const guestQuery = `
      SELECT
        g.id as guest_id,
        g.first_name,
        g.last_name,
        gbn.badge_number,
        gbn.edition_id
      FROM guests g
      JOIN guest_badge_numbers gbn ON g.id = gbn.guest_id
      JOIN editions e ON gbn.edition_id = e.id
      WHERE gbn.badge_number = $1
        AND e.year = $2
        AND gbn.edition_id = (SELECT edition_id FROM programming_schedule WHERE id = $3)
    `;

    const guestResult = await pool.query(guestQuery, [
      badgeNumber,
      parseInt(scannedStr.slice(0, 4)),
      programming_id
    ]);

    if (guestResult.rows.length === 0) {
      return { status: 404, body: { error: 'Badge number not found' } };
    }

    guest = guestResult.rows[0];
    guestId = guest.guest_id;
  } else if (isOneTimeTicket) {
    // One-time ticket - check if already used anywhere in this edition
    // (codes are reprinted each year, so last year's scans don't count)
    const usedQuery = `
      SELECT
        bs.id,
        bs.scanned_at AT TIME ZONE 'Europe/Prague' AS scanned_at,
        bs.programming_id,
        ps.scheduled_date,
        ps.scheduled_time,
        ps.title_override_cs,
        ps.title_override_en,
        v.name_cs,
        v.name_en,
        m.name_cs as movie_name_cs,
        m.name_en as movie_name_en,
        mb.name_cs as block_name_cs,
        mb.name_en as block_name_en
      FROM badge_scans bs
      JOIN programming_schedule ps ON bs.programming_id = ps.id
      JOIN venues v ON ps.venue_id = v.id
      LEFT JOIN movies m ON ps.movie_id = m.id
      LEFT JOIN movie_blocks mb ON ps.block_id = mb.id
      WHERE bs.badge_number = $1
        AND ps.edition_id = (SELECT edition_id FROM programming_schedule WHERE id = $2)
    `;

    const usedResult = await pool.query(usedQuery, [scannedStr, programming_id]);

    if (usedResult.rows.length > 0) {
      const used = usedResult.rows[0];
      const title = used.title_override_cs || used.movie_name_cs || used.block_name_cs;
      const venue = used.name_cs;
      const date = used.scheduled_date;
      const time = used.scheduled_time;

      return { status: 409, body: {
        error: 'Ticket already used',
        guest: {
          firstName: 'One-time',
          lastName: 'Ticket',
          badgeNumber: scannedStr
        },
        usedAt: used.scanned_at,
        usedFor: `${title} - ${venue} (${date} ${time})`
      } };
    }

    // Ticket is valid and not used - no guest record
    guestId = null;
  }

  // Check if already scanned for THIS screening (internal badges and GoOut tickets)
  if (isInternalBadge || isGoOutTicket) {
    const existingQuery = isInternalBadge
      ? `SELECT id FROM badge_scans WHERE programming_id = $1 AND guest_id = $2`
      : `SELECT id, goout_status, holder_name FROM badge_scans WHERE programming_id = $1 AND badge_number = $2`;

    const existingResult = await pool.query(existingQuery,
      isInternalBadge ? [programming_id, guestId] : [programming_id, String(badgeIdentifier)]
    );

    if (existingResult.rows.length > 0) {
      return { status: 409, body: {
        error: 'Badge already scanned for this screening',
        guest: guest ? {
          firstName: guest.first_name,
          lastName: guest.last_name,
          badgeNumber: guest.badge_number
        } : {
          ...scanLabel(scannedStr, existingResult.rows[0].goout_status, existingResult.rows[0].holder_name),
          badgeNumber: badgeIdentifier
        }
      } };
    }
  }

  // GoOut ticket: verify and check in at GoOut. If GoOut does not answer in
  // time it is let in as unverified; the local check above still blocks
  // double entry to this screening.
  let gooutStatus = null;
  let holderName = null;
  if (isGoOutTicket) {
    const verdict = await verifyGoOutTicket(scannedStr, programming_id);
    if (verdict.rejected) {
      return { status: verdict.httpStatus, body: {
        error: verdict.error,
        guest: { firstName: 'GoOut ticket', lastName: '', badgeNumber: scannedStr },
        usedFor: verdict.usedFor
      } };
    }
    gooutStatus = verdict.status;
    holderName = verdict.holderName || null;
  }

  // Insert scan record
  const insertQuery = `
    INSERT INTO badge_scans (programming_id, guest_id, badge_number, scanned_by, goout_status, holder_name, scanner_device_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, scanned_at AT TIME ZONE 'Europe/Prague' AS scanned_at
  `;

  const insertResult = await pool.query(insertQuery, [
    programming_id,
    guestId,
    String(badgeIdentifier),
    scannedBy,
    gooutStatus,
    holderName,
    scannerDeviceId
  ]);

  // Get updated scan count
  const countQuery = `
    SELECT COUNT(*) as count FROM badge_scans
    WHERE programming_id = $1
  `;

  const countResult = await pool.query(countQuery, [programming_id]);

  return { status: 200, body: {
    success: true,
    guest: guest ? {
      firstName: guest.first_name,
      lastName: guest.last_name,
      badgeNumber: guest.badge_number
    } : {
      ...scanLabel(scannedStr, gooutStatus, holderName),
      badgeNumber: scannedStr
    },
    scanId: insertResult.rows[0].id,
    scannedAt: insertResult.rows[0].scanned_at,
    totalScans: parseInt(countResult.rows[0].count)
  } };
}

// All scans of a screening, newest first
async function listScans(programmingId) {
  const result = await pool.query(`
    SELECT
      bs.id,
      bs.badge_number,
      bs.scanned_at AT TIME ZONE 'Europe/Prague' AS scanned_at,
      bs.scanned_by,
      bs.goout_status,
      bs.holder_name,
      g.first_name,
      g.last_name,
      bs.guest_id
    FROM badge_scans bs
    LEFT JOIN guests g ON bs.guest_id = g.id
    WHERE bs.programming_id = $1
    ORDER BY bs.scanned_at DESC
  `, [programmingId]);

  return result.rows.map(row => {
    const { firstName, lastName, category } = row.guest_id
      ? { firstName: row.first_name, lastName: row.last_name }
      : scanLabel(row.badge_number, row.goout_status, row.holder_name);

    return {
      id: row.id,
      badgeNumber: row.badge_number,
      firstName,
      lastName,
      category,
      scannedAt: row.scanned_at,
      scannedBy: row.scanned_by
    };
  });
}

module.exports = { processScan, listScans, scanLabel };
