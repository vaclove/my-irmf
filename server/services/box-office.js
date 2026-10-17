const bwipjs = require('bwip-js');
const { pool } = require('../models/database');
const { generateBoxOfficeCode } = require('../utils/boxOfficeCode');
const { getSoldBySchedule } = require('./goout-presale');

/**
 * Box office: tickets sold at the venue and printed on the thermal printer
 * (migration 068_create_box_office.sql).
 *
 * A screening's capacity is its ticket_capacity, else the venue capacity. It is
 * shared with GoOut: box office may sell what is left after the valid GoOut
 * tickets (paid and free) and the box-office tickets already sold. The GoOut
 * count is loaded fresh for every sale; GoOut keeps selling online on its own,
 * so its capacity in the GoOut admin should leave room for the box office.
 */

const PAYMENT_METHODS = ['cash', 'card'];
const MAX_TICKETS_PER_SALE = 20;

class BoxOfficeError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Screenings with tickets: timed, not free, not admin-only (same as the scanner)
const SCREENING_SELECT = `
  SELECT
    ps.id,
    ps.edition_id,
    ps.scheduled_date::text AS date,
    to_char(ps.scheduled_time, 'HH24:MI') AS time,
    ps.total_runtime,
    COALESCE(NULLIF(ps.title_override_cs, ''), m.name_cs, mb.name_cs) AS title,
    COALESCE(NULLIF(ps.title_override_en, ''), m.name_en, mb.name_en) AS title_en,
    v.name_cs AS venue,
    v.capacity AS venue_capacity,
    ps.ticket_capacity,
    ps.goout_schedule_id,
    ((ps.scheduled_date + ps.scheduled_time) AT TIME ZONE 'Europe/Prague')
      + (COALESCE(ps.total_runtime, 0) || ' minutes')::interval < now() AS ended,
    (SELECT COUNT(*) FROM box_office_tickets t
      WHERE t.programming_id = ps.id AND t.cancelled_at IS NULL)::int AS box_office_sold,
    (SELECT COALESCE(SUM(t.price_cents), 0) FROM box_office_tickets t
      WHERE t.programming_id = ps.id AND t.cancelled_at IS NULL)::int AS box_office_revenue_cents,
    EXISTS (SELECT 1 FROM box_office_categories c
      WHERE c.programming_id = ps.id AND c.active) AS custom_prices
  FROM programming_schedule ps
  JOIN venues v ON v.id = ps.venue_id
  LEFT JOIN movies m ON m.id = ps.movie_id
  LEFT JOIN movie_blocks mb ON mb.id = ps.block_id
  WHERE ps.scheduled_time IS NOT NULL
    AND ps.free_entry = false
    AND ps.hidden_from_public IS NOT TRUE
`;

/**
 * Capacity of a screening with its GoOut and box-office tickets.
 * @param {object} row - SCREENING_SELECT row
 * @param {object|undefined} goout - getSoldBySchedule entry of its GoOut schedule
 */
function withAvailability(row, goout) {
  const capacity = row.ticket_capacity ?? row.venue_capacity;
  const gooutSold = row.goout_schedule_id ? (goout?.sold ?? null) : 0;
  const gooutError = row.goout_schedule_id && !goout
    ? 'GoOut sales not loaded'
    : goout?.error || null;
  const available = capacity == null || gooutSold == null
    ? null
    : Math.max(capacity - gooutSold - row.box_office_sold, 0);

  return {
    id: row.id,
    date: row.date,
    time: row.time,
    runtime: row.total_runtime,
    title: row.title,
    titleEn: row.title_en,
    venue: row.venue,
    venueCapacity: row.venue_capacity,
    ticketCapacity: row.ticket_capacity,
    capacity,
    ended: row.ended,
    gooutLinked: !!row.goout_schedule_id,
    gooutSold,
    gooutSoldOut: !!goout?.soldOut,
    gooutStale: !!goout?.stale,
    gooutError,
    boxOfficeSold: row.box_office_sold,
    boxOfficeRevenueCents: row.box_office_revenue_cents,
    customPrices: row.custom_prices,
    available
  };
}

async function loadGoOutSold(rows, fresh) {
  const scheduleIds = [...new Set(rows.map(r => r.goout_schedule_id).filter(Boolean))];
  if (!scheduleIds.length) return {};
  try {
    return await getSoldBySchedule(scheduleIds, { fresh });
  } catch (error) {
    // GoOut sale list unavailable: every linked screening reports the error
    return Object.fromEntries(scheduleIds.map(id => [id, { error: error.message }]));
  }
}

/** Screenings of an edition with their capacity (GoOut counts may be up to 5 minutes old). */
async function listScreenings(editionId) {
  const { rows } = await pool.query(
    `${SCREENING_SELECT} AND ps.edition_id = $1 ORDER BY ps.scheduled_date, ps.scheduled_time`,
    [editionId]
  );
  const goout = await loadGoOutSold(rows, false);
  return rows.map(row => withAvailability(row, goout[row.goout_schedule_id]));
}

/** One screening with its capacity, GoOut tickets loaded fresh. */
async function getScreening(programmingId, { fresh = true } = {}) {
  const { rows } = await pool.query(`${SCREENING_SELECT} AND ps.id = $1`, [programmingId]);
  if (!rows[0]) return null;
  const goout = await loadGoOutSold(rows, fresh);
  return withAvailability(rows[0], goout[rows[0].goout_schedule_id]);
}

async function setTicketCapacity(programmingId, ticketCapacity) {
  const value = ticketCapacity === '' || ticketCapacity == null ? null : Number(ticketCapacity);
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new BoxOfficeError(400, 'Capacity must be a whole number');
  }
  const result = await pool.query(
    'UPDATE programming_schedule SET ticket_capacity = $1 WHERE id = $2 RETURNING id',
    [value, programmingId]
  );
  if (!result.rows[0]) throw new BoxOfficeError(404, 'Screening not found');
  return getScreening(programmingId, { fresh: false });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function parseCategory({ name, price_cents }) {
  const trimmed = String(name || '').trim();
  const price = Number(price_cents);
  if (!trimmed) throw new BoxOfficeError(400, 'Name is required');
  if (trimmed.length > 100) throw new BoxOfficeError(400, 'Name is too long');
  if (!Number.isInteger(price) || price < 0) throw new BoxOfficeError(400, 'Price must be zero or more');
  return { name: trimmed, price };
}

const CATEGORY_COLUMNS = `c.id, c.name, c.price_cents, c.sort_order, c.active, c.programming_id,
  EXISTS (SELECT 1 FROM box_office_tickets t WHERE t.category_id = c.id) AS has_tickets`;
const CATEGORY_ORDER = 'ORDER BY c.active DESC, c.sort_order, c.price_cents DESC, c.name';

/**
 * Categories a screening sells: its own active ones if it has any, otherwise
 * the active defaults of its edition.
 */
const EFFECTIVE_CATEGORIES = `
  SELECT ${CATEGORY_COLUMNS}
  FROM box_office_categories c
  JOIN programming_schedule ps ON ps.id = $1
  WHERE c.active
    AND (c.programming_id = ps.id
      OR (c.programming_id IS NULL AND c.edition_id = ps.edition_id
          AND NOT EXISTS (SELECT 1 FROM box_office_categories own
                          WHERE own.programming_id = ps.id AND own.active)))
`;

async function listEffectiveCategories(programmingId, db = pool) {
  const { rows } = await db.query(`${EFFECTIVE_CATEGORIES} ${CATEGORY_ORDER}`, [programmingId]);
  return rows;
}

/**
 * Categories to manage: an edition's default price list, or a screening's own
 * price list (including inactive ones in both cases).
 */
async function listCategories({ editionId, programmingId }) {
  const { rows } = programmingId
    ? await pool.query(`SELECT ${CATEGORY_COLUMNS} FROM box_office_categories c
        WHERE c.programming_id = $1 ${CATEGORY_ORDER}`, [programmingId])
    : await pool.query(`SELECT ${CATEGORY_COLUMNS} FROM box_office_categories c
        WHERE c.edition_id = $1 AND c.programming_id IS NULL ${CATEGORY_ORDER}`, [editionId]);
  return rows;
}

// Edition of a screening, or 404
async function screeningEdition(programmingId, db = pool) {
  const { rows } = await db.query('SELECT edition_id FROM programming_schedule WHERE id = $1', [programmingId]);
  if (!rows[0]) throw new BoxOfficeError(404, 'Screening not found');
  return rows[0].edition_id;
}

/** New category in an edition's default price list, or in a screening's own (body.programming_id). */
async function createCategory(editionId, body) {
  const { name, price } = parseCategory(body);
  const programmingId = body.programming_id || null;
  if (programmingId && await screeningEdition(programmingId) !== editionId) {
    throw new BoxOfficeError(400, 'Screening is not in this edition');
  }
  const { rows } = await pool.query(`
    INSERT INTO box_office_categories (edition_id, programming_id, name, price_cents, sort_order)
    VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM box_office_categories
                             WHERE edition_id = $1 AND programming_id IS NOT DISTINCT FROM $2))
    RETURNING id, name, price_cents, sort_order, active, programming_id
  `, [editionId, programmingId, name, price]);
  return rows[0];
}

/** Give a screening its own price list, starting as a copy of the edition defaults. */
async function customizePrices(programmingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM programming_schedule WHERE id = $1 FOR UPDATE', [programmingId]);
    const editionId = await screeningEdition(programmingId, client);
    const own = await client.query(
      'SELECT 1 FROM box_office_categories WHERE programming_id = $1 AND active', [programmingId]);
    if (!own.rows.length) {
      await client.query(`
        INSERT INTO box_office_categories (edition_id, programming_id, name, price_cents, sort_order)
        SELECT edition_id, $2, name, price_cents, sort_order
        FROM box_office_categories
        WHERE edition_id = $1 AND programming_id IS NULL AND active
      `, [editionId, programmingId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return listCategories({ programmingId });
}

/**
 * Back to the edition's default price list: the screening's own categories are
 * deleted, or deactivated when they sold tickets.
 */
async function useDefaultPrices(programmingId) {
  await screeningEdition(programmingId);
  await pool.query(`
    DELETE FROM box_office_categories c
    WHERE c.programming_id = $1
      AND NOT EXISTS (SELECT 1 FROM box_office_tickets t WHERE t.category_id = c.id)
  `, [programmingId]);
  await pool.query(`
    UPDATE box_office_categories SET active = false, updated_at = now()
    WHERE programming_id = $1 AND active
  `, [programmingId]);
}

async function updateCategory(id, body) {
  const { name, price } = parseCategory(body);
  const { rows } = await pool.query(`
    UPDATE box_office_categories
    SET name = $2, price_cents = $3, active = COALESCE($4, active), updated_at = now()
    WHERE id = $1
    RETURNING id, name, price_cents, sort_order, active, programming_id
  `, [id, name, price, typeof body.active === 'boolean' ? body.active : null]);
  if (!rows[0]) throw new BoxOfficeError(404, 'Category not found');
  return rows[0];
}

// Categories that sold tickets are only deactivated, so their sales keep the link
async function deleteCategory(id) {
  const { rows } = await pool.query(`
    WITH used AS (SELECT EXISTS (SELECT 1 FROM box_office_tickets WHERE category_id = $1) AS used),
    deactivated AS (
      UPDATE box_office_categories SET active = false, updated_at = now()
      WHERE id = $1 AND (SELECT used FROM used) RETURNING id
    ),
    deleted AS (
      DELETE FROM box_office_categories WHERE id = $1 AND NOT (SELECT used FROM used) RETURNING id
    )
    SELECT (SELECT id FROM deactivated) AS deactivated, (SELECT id FROM deleted) AS deleted
  `, [id]);
  if (!rows[0].deactivated && !rows[0].deleted) throw new BoxOfficeError(404, 'Category not found');
  return { deactivated: !!rows[0].deactivated };
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function qrSvg(code) {
  return bwipjs.toSVG({ bcid: 'qrcode', text: code, eclevel: 'M' });
}

// What the printed ticket shows
function printable(ticket, screening) {
  return {
    id: ticket.id,
    code: ticket.code,
    qrSvg: qrSvg(ticket.code),
    categoryName: ticket.category_name,
    priceCents: ticket.price_cents,
    holderName: ticket.holder_name || null,
    paymentMethod: ticket.payment_method,
    soldAt: ticket.sold_at,
    screening: {
      title: screening.title,
      titleEn: screening.title_en ?? screening.titleEn,
      venue: screening.venue,
      date: screening.date,
      time: screening.time
    }
  };
}

const FREE_TICKET_NAME = 'Volná vstupenka';

/**
 * Issue tickets for a screening within its capacity: GoOut tickets loaded fresh,
 * the screening locked so box-office sales of it can't overbook each other.
 * @param {object} issue
 * @param {string} issue.programmingId
 * @param {number} issue.quantity - tickets in total
 * @param {function} issue.lines - (db client) => [{ category, quantity }], category { id, name, price_cents }
 * @param {string} issue.paymentMethod - 'cash', 'card' or 'free'
 * @param {object} [issue.extra] - soldBy, guestId, holderName, note
 */
async function issueTickets({ programmingId, quantity, lines, paymentMethod, extra }) {
  if (quantity > MAX_TICKETS_PER_SALE) {
    throw new BoxOfficeError(400, `At most ${MAX_TICKETS_PER_SALE} tickets at once`);
  }

  // GoOut first and outside the transaction: it can take a second or two
  const screening = await getScreening(programmingId, { fresh: true });
  if (!screening) throw new BoxOfficeError(404, 'Screening not found or has no tickets');
  if (screening.ended) throw new BoxOfficeError(409, 'The screening has already ended');
  if (screening.capacity == null) {
    throw new BoxOfficeError(409, 'The screening has no capacity; set the venue capacity or the ticket capacity');
  }
  if (screening.gooutSold == null) {
    throw new BoxOfficeError(503, `Could not load GoOut sales, try again (${screening.gooutError})`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resolved = await lines(client);

    // Locking the screening serialises box-office sales of it
    await client.query('SELECT id FROM programming_schedule WHERE id = $1 FOR UPDATE', [programmingId]);
    const local = await client.query(
      'SELECT COUNT(*)::int AS sold FROM box_office_tickets WHERE programming_id = $1 AND cancelled_at IS NULL',
      [programmingId]
    );
    const available = Math.max(screening.capacity - screening.gooutSold - local.rows[0].sold, 0);
    if (quantity > available) {
      throw new BoxOfficeError(409,
        available === 0 ? 'Sold out' : `Only ${available} ${available === 1 ? 'ticket' : 'tickets'} left`,
        { available });
    }

    const orderId = (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const tickets = [];
    for (const { category, quantity: count } of resolved) {
      for (let i = 0; i < count; i++) {
        let inserted = null;
        // A random code may already exist; draw another one
        for (let attempt = 0; !inserted && attempt < 10; attempt++) {
          const result = await client.query(`
            INSERT INTO box_office_tickets
              (code, order_id, programming_id, category_id, category_name, price_cents, payment_method,
               sold_by, guest_id, holder_name, note)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (code) DO NOTHING
            RETURNING id, code, category_name, price_cents, payment_method, sold_at, holder_name
          `, [generateBoxOfficeCode(), orderId, programmingId, category.id, category.name,
            category.price_cents, paymentMethod, extra.soldBy || null, extra.guestId || null,
            extra.holderName || null, extra.note || null]);
          inserted = result.rows[0];
        }
        if (!inserted) throw new Error('Could not generate a unique ticket code');
        tickets.push(inserted);
      }
    }

    await client.query('COMMIT');

    const after = { ...screening, boxOfficeSold: local.rows[0].sold + quantity, available: available - quantity };
    return {
      orderId,
      totalCents: tickets.reduce((sum, t) => sum + t.price_cents, 0),
      tickets: tickets.map(t => printable(t, screening)),
      screening: after
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Sell tickets for a screening, within its capacity.
 * @param {object} sale
 * @param {string} sale.programmingId
 * @param {Array<{category_id: string, quantity: number}>} sale.items
 * @param {string} sale.paymentMethod - 'cash' or 'card'
 * @param {string} sale.soldBy - staff email
 * @returns {Promise<{orderId, tickets, screening}>} tickets ready to print
 */
async function sellTickets({ programmingId, items, paymentMethod, soldBy }) {
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new BoxOfficeError(400, 'Payment method must be cash or card');
  }
  const wanted = (Array.isArray(items) ? items : [])
    .map(item => ({ categoryId: item.category_id, quantity: Number(item.quantity) }))
    .filter(item => item.quantity > 0);
  if (!wanted.length || wanted.some(item => !Number.isInteger(item.quantity))) {
    throw new BoxOfficeError(400, 'Choose at least one ticket');
  }

  return issueTickets({
    programmingId,
    quantity: wanted.reduce((sum, item) => sum + item.quantity, 0),
    paymentMethod,
    extra: { soldBy },
    // Only categories this screening sells (its own, or the edition defaults)
    lines: async (client) => {
      const effective = await listEffectiveCategories(programmingId, client);
      const categoryById = Object.fromEntries(effective.map(c => [c.id, c]));
      if (wanted.some(item => !categoryById[item.categoryId])) {
        throw new BoxOfficeError(400, 'This ticket category is not sold for this screening, reload the page');
      }
      return wanted.map(item => ({ category: categoryById[item.categoryId], quantity: item.quantity }));
    }
  });
}

/**
 * Free tickets, printed now. They take seats like sold tickets. Issued to an
 * existing guest, the scan at the door is recorded for that guest.
 * @param {object} issue
 * @param {string} issue.programmingId
 * @param {number} issue.quantity
 * @param {string|null} issue.guestId - existing guest, optional
 * @param {string|null} issue.note - e.g. partner, jury
 * @param {string} issue.soldBy - staff email
 */
async function issueFreeTickets({ programmingId, quantity, guestId, note, soldBy }) {
  const count = Number(quantity);
  if (!Number.isInteger(count) || count < 1) throw new BoxOfficeError(400, 'Choose at least one ticket');
  const trimmedNote = String(note || '').trim().slice(0, 200) || null;

  let holderName = null;
  if (guestId) {
    const { rows } = await pool.query('SELECT first_name, last_name FROM guests WHERE id = $1', [guestId]);
    if (!rows[0]) throw new BoxOfficeError(404, 'Guest not found');
    holderName = [rows[0].first_name, rows[0].last_name].filter(Boolean).join(' ').trim() || null;
  }

  return issueTickets({
    programmingId,
    quantity: count,
    paymentMethod: 'free',
    extra: { soldBy, guestId, holderName, note: trimmedNote },
    lines: async () => [{ category: { id: null, name: FREE_TICKET_NAME, price_cents: 0 }, quantity: count }]
  });
}

/** Guests matching a name or email, for free tickets. */
async function searchGuests(query) {
  const term = String(query || '').trim();
  if (term.length < 2) return [];
  const { rows } = await pool.query(`
    SELECT g.id, g.first_name, g.last_name, g.email
    FROM guests g
    WHERE (g.first_name || ' ' || g.last_name) ILIKE $1
       OR (g.last_name || ' ' || g.first_name) ILIKE $1
       OR g.email ILIKE $1
    ORDER BY g.last_name, g.first_name
    LIMIT 20
  `, [`%${term.replace(/[\\%_]/g, '\\$&')}%`]);
  return rows;
}

const TICKET_SELECT = `
  SELECT t.id, t.code, t.order_id, t.programming_id, t.category_name, t.price_cents,
         t.payment_method, t.sold_by, t.sold_at, t.printed_count, t.cancelled_at, t.cancelled_by,
         t.guest_id, t.holder_name, t.note,
         EXISTS (SELECT 1 FROM badge_scans bs
                 WHERE bs.programming_id = t.programming_id AND bs.badge_number = t.code) AS scanned
  FROM box_office_tickets t
`;

async function listTickets(programmingId) {
  const { rows } = await pool.query(
    `${TICKET_SELECT} WHERE t.programming_id = $1 ORDER BY t.sold_at DESC, t.code`,
    [programmingId]
  );
  return rows;
}

/** Print a ticket again; counts the reprints. */
async function reprintTicket(ticketId) {
  // The screening without the sale filters: it may have become free or hidden since
  const { rows: [screening] } = await pool.query(`
    SELECT ps.scheduled_date::text AS date,
           to_char(ps.scheduled_time, 'HH24:MI') AS time,
           COALESCE(NULLIF(ps.title_override_cs, ''), m.name_cs, mb.name_cs) AS title,
           COALESCE(NULLIF(ps.title_override_en, ''), m.name_en, mb.name_en) AS title_en,
           v.name_cs AS venue
    FROM box_office_tickets t
    JOIN programming_schedule ps ON ps.id = t.programming_id
    JOIN venues v ON v.id = ps.venue_id
    LEFT JOIN movies m ON m.id = ps.movie_id
    LEFT JOIN movie_blocks mb ON mb.id = ps.block_id
    WHERE t.id = $1
  `, [ticketId]);
  if (!screening) throw new BoxOfficeError(404, 'Ticket not found');

  const { rows } = await pool.query(`
    UPDATE box_office_tickets SET printed_count = printed_count + 1
    WHERE id = $1 AND cancelled_at IS NULL
    RETURNING id, code, programming_id, category_name, price_cents, payment_method, sold_at, holder_name
  `, [ticketId]);
  if (!rows[0]) throw new BoxOfficeError(404, 'Ticket not found or cancelled');
  return printable(rows[0], screening);
}

/** Cancel a ticket that hasn't been scanned; it no longer counts into capacity or revenue. */
async function cancelTicket(ticketId, cancelledBy) {
  const { rows } = await pool.query(`${TICKET_SELECT} WHERE t.id = $1`, [ticketId]);
  const ticket = rows[0];
  if (!ticket) throw new BoxOfficeError(404, 'Ticket not found');
  if (ticket.cancelled_at) throw new BoxOfficeError(409, 'Ticket is already cancelled');
  if (ticket.scanned) throw new BoxOfficeError(409, 'Ticket has already been scanned at the door');

  // Re-checked in the update: a scan may land between the checks above and here
  const result = await pool.query(`
    UPDATE box_office_tickets t SET cancelled_at = now(), cancelled_by = $2
    WHERE t.id = $1 AND t.cancelled_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM badge_scans bs
                      WHERE bs.programming_id = t.programming_id AND bs.badge_number = t.code)
    RETURNING t.id, t.code, t.cancelled_at
  `, [ticketId, cancelledBy]);
  if (!result.rows[0]) throw new BoxOfficeError(409, 'Ticket is already cancelled or has been scanned');
  return result.rows[0];
}

/**
 * Box-office takings of an edition per Prague day, payment method and category,
 * for the cash-up. Cancelled tickets are left out.
 */
async function getSummary(editionId) {
  const { rows } = await pool.query(`
    SELECT (t.sold_at AT TIME ZONE 'Europe/Prague')::date::text AS day,
           t.payment_method, t.category_name,
           COUNT(*)::int AS tickets,
           SUM(t.price_cents)::int AS revenue_cents
    FROM box_office_tickets t
    JOIN programming_schedule ps ON ps.id = t.programming_id
    WHERE ps.edition_id = $1 AND t.cancelled_at IS NULL
    GROUP BY 1, 2, 3
    ORDER BY 1 DESC, 2, 3
  `, [editionId]);
  return rows;
}

module.exports = {
  BoxOfficeError,
  listScreenings,
  getScreening,
  setTicketCapacity,
  listCategories,
  listEffectiveCategories,
  createCategory,
  customizePrices,
  useDefaultPrices,
  updateCategory,
  deleteCategory,
  sellTickets,
  issueFreeTickets,
  searchGuests,
  listTickets,
  reprintTicket,
  cancelTicket,
  getSummary
};
