const goOutAPI = require('./goout-api');
const { pool } = require('../models/database');

// GoOut gets this long to answer; after that the scan falls back to local-only
// handling (stored with us, double entry blocked per screening)
const GOOUT_TIMEOUT_MS = 1000;

/**
 * GoOut tickets carry a QR code with a 13-digit id that has an EAN-13 check
 * digit. Requiring it filters out misreads of our own Code128 barcodes.
 */
function isGoOutTicketCode(code) {
  if (!/^\d{13}$/.test(code)) {
    return false;
  }

  const sum = [...code.slice(0, 12)].reduce((acc, digit, i) => acc + Number(digit) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`GoOut did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function describeScreening(gooutScheduleId) {
  const result = await pool.query(`
    SELECT
      ps.scheduled_date,
      ps.scheduled_time,
      COALESCE(ps.title_override_cs, m.name_cs, mb.name_cs) AS title,
      v.name_cs AS venue
    FROM programming_schedule ps
    JOIN venues v ON ps.venue_id = v.id
    LEFT JOIN movies m ON ps.movie_id = m.id
    LEFT JOIN movie_blocks mb ON ps.block_id = mb.id
    WHERE ps.goout_schedule_id = $1
    ORDER BY ps.scheduled_date DESC
    LIMIT 1
  `, [gooutScheduleId]);

  const row = result.rows[0];
  return row ? `${row.title} - ${row.venue} (${row.scheduled_date} ${row.scheduled_time})` : null;
}

async function checkWithGoOut(barcode, screening) {
  const ticket = await goOutAPI.findTicket(barcode, { timeout: GOOUT_TIMEOUT_MS });

  if (!ticket) {
    return { rejected: true, httpStatus: 404, error: 'Ticket not found in GoOut' };
  }

  if (ticket.state !== 'paid') {
    return { rejected: true, httpStatus: 409, error: `Ticket is ${ticket.state}` };
  }

  if (ticket.scheduleId === String(screening.goout_schedule_id)) {
    if (!screening.goout_checkin_id) {
      return { status: 'checked_in' };
    }

    try {
      await goOutAPI.checkInTicket(barcode, screening.goout_checkin_id, { timeout: GOOUT_TIMEOUT_MS });
      return { status: 'checked_in' };
    } catch (error) {
      if (error.response?.status === 422) {
        return { rejected: true, httpStatus: 409, error: 'Ticket already used' };
      }
      throw error;
    }
  }

  if (ticket.isFestivalPass) {
    // Only this edition's pass; it is linked to the hidden accreditation entry
    const pass = await pool.query(
      'SELECT 1 FROM programming_schedule WHERE edition_id = $1 AND goout_schedule_id = $2',
      [screening.edition_id, ticket.scheduleId]
    );
    if (pass.rows.length > 0) {
      return { status: 'pass' };
    }
    return { rejected: true, httpStatus: 409, error: 'Festival pass from another edition' };
  }

  return {
    rejected: true,
    httpStatus: 409,
    error: 'Ticket is for another screening',
    usedFor: await describeScreening(ticket.scheduleId)
  };
}

/**
 * Verify a GoOut ticket for a screening.
 * @returns {Promise<{status: string}|{rejected: true, httpStatus: number, error: string, usedFor?: string}>}
 *   status is 'checked_in', 'pass' or 'unverified' (GoOut unavailable or screening not linked)
 */
async function verifyGoOutTicket(barcode, programmingId) {
  const result = await pool.query(
    'SELECT edition_id, goout_schedule_id, goout_checkin_id FROM programming_schedule WHERE id = $1',
    [programmingId]
  );
  const screening = result.rows[0];

  if (!screening?.goout_schedule_id) {
    return { status: 'unverified' };
  }

  try {
    return await withTimeout(checkWithGoOut(barcode, screening), GOOUT_TIMEOUT_MS);
  } catch (error) {
    console.warn(`GoOut verification of ${barcode} failed, letting in unverified:`, error.message);
    return { status: 'unverified' };
  }
}

module.exports = {
  isGoOutTicketCode,
  verifyGoOutTicket
};
