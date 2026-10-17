const crypto = require('crypto');
const goOutAPI = require('./goout-api');
const { pool } = require('../models/database');
const { getEditionPassSales, VALID_TICKET_STATES, relId } = require('./goout-presale');
const { generateGreeting } = require('../utils/greetingGenerator');

/**
 * Festival passes bought on GoOut, converted to our badges (Tickets → Accreditations,
 * migration 070_create_goout_accreditations.sql).
 *
 * Converting a pass creates a guest of category 'public' in the edition (year and
 * 'public' tags, guest_editions, a confirmed manual invitation, a badge number),
 * so the badge prints with the 'public' layout. goout_accreditations links the
 * GoOut ticket to that guest; its unique ticket id makes sure one pass gives one
 * badge. The scanner rejects converted passes (goout-ticket-verifier.js).
 */

const CATEGORY = 'public';
const TICKET_ID_RE = /^\d{13}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class AccreditationError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const formatBadgeNumber = (year, number) =>
  number == null ? null : `${year}${String(number).padStart(3, '0')}`;

// GoOut purchase language -> guest language
const guestLanguage = (language) => (['cs', 'sk'].includes(language) ? 'czech' : 'english');

/**
 * All tickets of the edition's festival pass sales, loaded fresh from GoOut.
 */
async function loadPassTickets(editionId) {
  const sales = await getEditionPassSales(editionId);
  const tickets = [];

  for (const sale of sales) {
    const dealNames = Object.fromEntries(sale.deals.map(d => [d.id, d.name]));
    const purchases = {};
    const saleTickets = [];

    for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
      const response = await goOutAPI.apiRequest('GET', '/services/reporting/v1/purchases', null, {
        'saleIds[]': [sale.saleId],
        'languages[]': ['cs'],
        include: 'tickets',
        pageIndex
      });
      for (const purchase of response.purchases || []) purchases[purchase.id] = purchase;
      saleTickets.push(...(response.included?.tickets || []));
      if (!response.meta?.hasNext) break;
    }

    for (const ticket of saleTickets) {
      const purchaseId = relId(ticket.relationships?.purchase);
      const purchase = purchases[purchaseId]?.attributes || {};
      const state = String(ticket.attributes?.state || '').toLowerCase();
      tickets.push({
        ticketId: String(ticket.id),
        purchaseId,
        firstName: (ticket.attributes?.firstName || purchase.firstName || '').trim(),
        lastName: (ticket.attributes?.lastName || purchase.lastName || '').trim(),
        email: (purchase.email || '').trim(),
        phone: (purchase.phone || '').trim(),
        language: guestLanguage(purchase.language),
        state,
        valid: VALID_TICKET_STATES.has(state),
        dealName: dealNames[relId(ticket.relationships?.deal)] || null,
        priceCents: ticket.attributes?.priceCents ?? null,
        paidAt: purchase.paidAt || purchase.createdAt || null
      });
    }
  }

  return { tickets, hasPassSale: sales.length > 0 };
}

async function loadEdition(editionId, db = pool) {
  const { rows } = await db.query('SELECT id, year FROM editions WHERE id = $1', [editionId]);
  if (!rows[0]) throw new AccreditationError(404, 'Edition not found');
  return rows[0];
}

async function loadConversions(editionId) {
  const { rows } = await pool.query(`
    SELECT ga.goout_ticket_id, ga.guest_id, ga.converted_by, ga.converted_at,
           g.first_name, g.last_name, g.email, e.year, gbn.badge_number, ge.badge_printed_at
    FROM goout_accreditations ga
    JOIN guests g ON g.id = ga.guest_id
    JOIN editions e ON e.id = ga.edition_id
    LEFT JOIN guest_badge_numbers gbn ON gbn.guest_id = ga.guest_id AND gbn.edition_id = ga.edition_id
    LEFT JOIN guest_editions ge ON ge.guest_id = ga.guest_id AND ge.edition_id = ga.edition_id
    WHERE ga.edition_id = $1
  `, [editionId]);

  return rows.map(row => ({
    ticketId: row.goout_ticket_id,
    guestId: row.guest_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    badgeNumber: formatBadgeNumber(row.year, row.badge_number),
    badgePrintedAt: row.badge_printed_at,
    convertedBy: row.converted_by,
    convertedAt: row.converted_at
  }));
}

/**
 * The edition's GoOut passes with their conversions. When GoOut can't be reached
 * the converted passes still come back (gooutError set), so badges can be reprinted.
 */
async function listAccreditations(editionId) {
  await loadEdition(editionId);
  const conversions = await loadConversions(editionId);
  const byTicket = new Map(conversions.map(c => [c.ticketId, c]));

  let gooutError = null;
  let loaded = { tickets: [], hasPassSale: true };
  try {
    loaded = await loadPassTickets(editionId);
  } catch (error) {
    console.error('GoOut accreditations: loading passes failed:', error.message);
    gooutError = `GoOut passes unavailable: ${error.message}`;
  }

  const tickets = loaded.tickets.map(t => ({ ...t, conversion: byTicket.get(t.ticketId) || null }));
  const listed = new Set(tickets.map(t => t.ticketId));
  // Converted passes GoOut didn't return (GoOut down, or sale no longer linked)
  for (const c of conversions) {
    if (!listed.has(c.ticketId)) {
      tickets.push({
        ticketId: c.ticketId, firstName: c.firstName, lastName: c.lastName, email: c.email || '',
        state: null, valid: null, notOnGoOut: !gooutError, conversion: c
      });
    }
  }

  tickets.sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'cs') ||
    a.ticketId.localeCompare(b.ticketId));

  return { tickets, hasPassSale: loaded.hasPassSale, gooutError };
}

function cleanText(value, label, { required = false, max = 255 } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new AccreditationError(400, `${label} is required`);
  if (text.length > max) throw new AccreditationError(400, `${label} is too long`);
  return text;
}

async function ensureTag(client, name) {
  const { rows } = await client.query(`
    INSERT INTO tags (name) VALUES ($1)
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `, [name]);
  return rows[0].id;
}

async function describeConversion(client, ticketId) {
  const { rows } = await client.query(`
    SELECT ga.guest_id, g.first_name, g.last_name, e.year, gbn.badge_number
    FROM goout_accreditations ga
    JOIN guests g ON g.id = ga.guest_id
    JOIN editions e ON e.id = ga.edition_id
    LEFT JOIN guest_badge_numbers gbn ON gbn.guest_id = ga.guest_id AND gbn.edition_id = ga.edition_id
    WHERE ga.goout_ticket_id = $1
  `, [ticketId]);
  const row = rows[0];
  if (!row) return null;
  return {
    guestId: row.guest_id,
    name: `${row.first_name} ${row.last_name}`,
    badgeNumber: formatBadgeNumber(row.year, row.badge_number)
  };
}

function alreadyConverted(existing) {
  const badge = existing.badgeNumber ? `badge ${existing.badgeNumber}` : 'a badge';
  return new AccreditationError(409, `This pass was already converted to ${badge} (${existing.name})`, {
    alreadyConverted: existing
  });
}

/**
 * Convert a GoOut pass: create its guest (or use an existing one) and give them a badge.
 * @param {object} input
 * @param {string} input.editionId
 * @param {string} input.ticketId - GoOut ticket id (the 13-digit code)
 * @param {string} input.firstName
 * @param {string} input.lastName
 * @param {string} [input.email] - optional; must not belong to another guest
 * @param {string} [input.phone]
 * @param {string} [input.language] - 'czech' | 'english'
 * @param {string} [input.guestId] - use this existing guest instead of creating one
 * @param {string} [input.convertedBy]
 * @returns {Promise<{guestId: string, badgeNumber: string}>}
 */
async function convertAccreditation(input) {
  const ticketId = String(input.ticketId || '').trim();
  if (!TICKET_ID_RE.test(ticketId)) throw new AccreditationError(400, 'Invalid GoOut ticket code');

  const edition = await loadEdition(input.editionId);

  let firstName = null;
  let lastName = null;
  let email = null;
  let phone = null;
  let language = 'czech';
  if (!input.guestId) {
    firstName = cleanText(input.firstName, 'First name', { required: true });
    lastName = cleanText(input.lastName, 'Last name', { required: true });
    email = cleanText(input.email, 'Email') || null;
    if (email && !EMAIL_RE.test(email)) throw new AccreditationError(400, 'Invalid email');
    phone = cleanText(input.phone, 'Phone', { max: 50 }) || null;
    language = input.language === 'english' ? 'english' : 'czech';
  }

  // Verify the pass with GoOut right now; without GoOut nothing is converted
  let pass;
  try {
    const { tickets } = await loadPassTickets(edition.id);
    pass = tickets.find(t => t.ticketId === ticketId);
  } catch (error) {
    throw new AccreditationError(502, `Can't verify the pass, GoOut unavailable: ${error.message}`);
  }
  if (!pass) throw new AccreditationError(404, `Not an IRMF ${edition.year} festival pass on GoOut`);
  if (!pass.valid) throw new AccreditationError(409, `This pass is ${pass.state || 'not paid'} on GoOut`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await describeConversion(client, ticketId);
    if (existing) throw alreadyConverted(existing);

    let guestId = input.guestId || null;
    if (guestId) {
      const { rows } = await client.query('SELECT id FROM guests WHERE id = $1', [guestId]);
      if (!rows[0]) throw new AccreditationError(404, 'Guest not found');
      const held = await client.query(
        'SELECT goout_ticket_id FROM goout_accreditations WHERE guest_id = $1 AND edition_id = $2',
        [guestId, edition.id]
      );
      if (held.rows[0]) {
        throw new AccreditationError(409, `This guest already holds GoOut pass ${held.rows[0].goout_ticket_id} in this edition`);
      }
    } else {
      if (email) {
        const { rows } = await client.query(`
          SELECT g.id, g.first_name, g.last_name,
                 EXISTS (SELECT 1 FROM goout_accreditations ga
                         WHERE ga.guest_id = g.id AND ga.edition_id = $2) AS has_pass
          FROM guests g
          WHERE LOWER(g.email) = LOWER($1)
        `, [email, edition.id]);
        if (rows[0]) {
          throw new AccreditationError(409, 'A guest with this email already exists', {
            emailTaken: { id: rows[0].id, name: `${rows[0].first_name} ${rows[0].last_name}`, hasPass: rows[0].has_pass }
          });
        }
      }

      const { greeting } = generateGreeting(firstName, lastName, language);
      const { rows } = await client.query(`
        INSERT INTO guests (first_name, last_name, email, phone, language, notes, greeting, greeting_auto_generated)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        RETURNING id
      `, [firstName, lastName, email, phone, language, `GoOut festival pass ${ticketId}`, greeting]);
      guestId = rows[0].id;
    }

    // Same membership as a guest invited to the edition by hand
    for (const tagName of [String(edition.year), CATEGORY]) {
      const tagId = await ensureTag(client, tagName);
      await client.query(
        'INSERT INTO guest_tags (guest_id, tag_id) VALUES ($1, $2) ON CONFLICT (guest_id, tag_id) DO NOTHING',
        [guestId, tagId]
      );
    }

    // An existing guest keeps the category they already have in this edition
    await client.query(`
      INSERT INTO guest_editions (guest_id, edition_id, category, invited_at, confirmed_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (guest_id, edition_id) DO NOTHING
    `, [guestId, edition.id, CATEGORY]);

    const invited = await client.query(
      'SELECT 1 FROM guest_invitations WHERE guest_id = $1 AND edition_id = $2',
      [guestId, edition.id]
    );
    if (!invited.rows[0]) {
      await client.query(`
        INSERT INTO guest_invitations (guest_id, edition_id, template_id, token, invited_at, confirmed_at,
                                       status, manual_invitation, changed_by)
        VALUES ($1, $2,
                (SELECT id FROM email_templates WHERE template_type = 'invitation' ORDER BY created_at DESC LIMIT 1),
                $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'confirmed', true, $4)
      `, [guestId, edition.id, crypto.randomBytes(32).toString('hex'), input.convertedBy || null]);
    }

    await client.query(`
      INSERT INTO guest_badge_numbers (guest_id, edition_id, badge_number)
      VALUES ($1, $2, get_next_badge_number($2))
      ON CONFLICT (guest_id, edition_id) DO NOTHING
    `, [guestId, edition.id]);

    await client.query(`
      INSERT INTO goout_accreditations (goout_ticket_id, goout_purchase_id, edition_id, guest_id, converted_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [ticketId, pass.purchaseId, edition.id, guestId, input.convertedBy || null]);

    const badge = await client.query(
      'SELECT badge_number FROM guest_badge_numbers WHERE guest_id = $1 AND edition_id = $2',
      [guestId, edition.id]
    );

    await client.query('COMMIT');
    return { guestId, badgeNumber: formatBadgeNumber(edition.year, badge.rows[0].badge_number) };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      // Lost a race with another desk converting the same pass or using the same email
      if (error.constraint === 'goout_accreditations_goout_ticket_id_key') {
        const existing = await describeConversion(pool, ticketId);
        if (existing) throw alreadyConverted(existing);
      }
      if (error.constraint === 'guests_email_unique_idx') {
        throw new AccreditationError(409, 'A guest with this email already exists, try again');
      }
      if (error.constraint === 'goout_accreditations_guest_id_edition_id_key') {
        throw new AccreditationError(409, 'This guest already holds a GoOut pass in this edition');
      }
      throw new AccreditationError(409, 'Someone else is converting a pass right now, try again');
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The converted pass with this GoOut ticket id, if any (for the scanner).
 * @returns {Promise<{guestId, name, badgeNumber}|null>}
 */
function findConversion(ticketId) {
  return describeConversion(pool, String(ticketId));
}

module.exports = {
  AccreditationError,
  listAccreditations,
  convertAccreditation,
  findConversion
};
