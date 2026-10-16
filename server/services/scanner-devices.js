const crypto = require('crypto');
const bwipjs = require('bwip-js');
const { pool } = require('../models/database');

/**
 * Phones as scanners, without logging in.
 *
 * Staff create a link for a screening (shown as a QR code). Within 15 minutes any
 * number of phones can join it with an operator name; each gets its own session
 * key. A phone may scan the link's screening and the later screenings in the same
 * venue on that day, each until 1 hour after it ends. The session ends 1 hour after
 * the last of them, or when staff disconnect the phone.
 *
 * Link tokens and session keys are random and stored only as SHA-256 hashes.
 */

const JOIN_WINDOW = '15 minutes';

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = (bytes) => crypto.randomBytes(bytes).toString('base64url');

/**
 * Screenings a link covers: its own and the later ones in the same venue that day,
 * as in the staff scanner list (no all-day, free or admin-only entries).
 * scanUntil is 1 hour after the screening ends (programme times are Prague time).
 */
async function linkScreenings(anchorProgrammingId) {
  const { rows } = await pool.query(`
    SELECT
      ps.id,
      ps.scheduled_date,
      ps.scheduled_time,
      ps.total_runtime,
      ps.title_override_cs,
      ps.title_override_en,
      v.name_cs AS venue_name_cs,
      v.name_en AS venue_name_en,
      m.name_cs AS movie_name_cs,
      m.name_en AS movie_name_en,
      mb.name_cs AS block_name_cs,
      mb.name_en AS block_name_en,
      (SELECT COUNT(*) FROM badge_scans WHERE programming_id = ps.id)::int AS scan_count,
      ((ps.scheduled_date + ps.scheduled_time) AT TIME ZONE 'Europe/Prague')
        + (COALESCE(ps.total_runtime, 0) || ' minutes')::interval
        + interval '1 hour' AS scan_until
    FROM programming_schedule a
    JOIN programming_schedule ps
      ON ps.edition_id = a.edition_id
     AND ps.venue_id = a.venue_id
     AND ps.scheduled_date = a.scheduled_date
     AND ps.scheduled_time >= a.scheduled_time
    JOIN venues v ON ps.venue_id = v.id
    LEFT JOIN movies m ON ps.movie_id = m.id
    LEFT JOIN movie_blocks mb ON ps.block_id = mb.id
    WHERE a.id = $1
      AND ps.scheduled_time IS NOT NULL
      AND ps.free_entry = false
      AND ps.hidden_from_public IS NOT TRUE
    ORDER BY ps.scheduled_time
  `, [anchorProgrammingId]);

  // Same shape as the staff scanner's screenings
  return rows.map(row => ({
    id: row.id,
    date: row.scheduled_date,
    time: row.scheduled_time,
    runtime: row.total_runtime,
    venue: { cs: row.venue_name_cs, en: row.venue_name_en },
    title: {
      cs: row.title_override_cs || row.movie_name_cs || row.block_name_cs,
      en: row.title_override_en || row.movie_name_en || row.block_name_en
    },
    scanCount: row.scan_count,
    scanUntil: row.scan_until
  }));
}

const isOpen = (screening) => new Date(screening.scanUntil) > new Date();

/**
 * Create a link for a screening.
 * @returns {Promise<{token, joinUntil, screenings}|{error: string, status: number}>}
 */
async function createLink(programmingId, createdBy) {
  const exists = await pool.query('SELECT 1 FROM programming_schedule WHERE id = $1', [programmingId]);
  if (exists.rowCount === 0) return { status: 404, error: 'Screening not found' };

  // Only what a phone could still scan; a code for nothing would look valid but be refused
  const screenings = (await linkScreenings(programmingId)).filter(isOpen);
  if (screenings.length === 0) {
    return { status: 409, error: 'Nothing left to scan here today, the scanning window has closed' };
  }

  const token = newToken(24);
  const { rows } = await pool.query(`
    INSERT INTO scanner_links (programming_id, token_hash, created_by, join_until)
    VALUES ($1, $2, $3, now() + interval '${JOIN_WINDOW}')
    RETURNING join_until
  `, [programmingId, hash(token), createdBy]);

  return { token, joinUntil: rows[0].join_until, screenings };
}

async function findLink(token) {
  const { rows } = await pool.query(`
    SELECT id, programming_id, join_until, join_until > now() AS join_open
    FROM scanner_links WHERE token_hash = $1
  `, [hash(token)]);
  return rows[0] || null;
}

/**
 * What a phone sees before joining.
 * @returns {Promise<{joinOpen, joinUntil, screenings}|null>}
 */
async function getLink(token) {
  const link = await findLink(token);
  if (!link) return null;
  return {
    joinOpen: link.join_open,
    joinUntil: link.join_until,
    screenings: (await linkScreenings(link.programming_id)).filter(isOpen)
  };
}

/**
 * Join a link with an operator name.
 * @returns {Promise<{sessionToken, name, expiresAt}|{error: string, status: number}>}
 */
async function join(token, name, userAgent) {
  const operatorName = String(name || '').trim().slice(0, 100);
  if (!operatorName) return { status: 400, error: 'Please enter your name' };

  const link = await findLink(token);
  if (!link) return { status: 404, error: 'This scanner code is not valid' };
  if (!link.join_open) return { status: 410, error: 'This scanner code has expired, ask for a new one' };

  const screenings = (await linkScreenings(link.programming_id)).filter(isOpen);
  if (screenings.length === 0) return { status: 410, error: 'There is nothing left to scan today' };
  const expiresAt = new Date(Math.max(...screenings.map(s => new Date(s.scanUntil).getTime())));

  const sessionToken = newToken(32);
  await pool.query(`
    INSERT INTO scanner_devices (link_id, operator_name, session_hash, user_agent, expires_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [link.id, operatorName, hash(sessionToken), userAgent ? String(userAgent).slice(0, 500) : null, expiresAt]);

  return { sessionToken, name: operatorName, expiresAt };
}

/**
 * The phone behind a session key, if its session is still running.
 * @returns {Promise<{id, name, anchorProgrammingId, expiresAt}|null>}
 */
async function authenticate(sessionToken) {
  if (!sessionToken) return null;
  const { rows } = await pool.query(`
    SELECT d.id, d.operator_name, d.expires_at, l.programming_id
    FROM scanner_devices d
    JOIN scanner_links l ON l.id = d.link_id
    WHERE d.session_hash = $1 AND d.disconnected_at IS NULL AND d.expires_at > now()
  `, [hash(sessionToken)]);
  const device = rows[0];
  if (!device) return null;

  await pool.query(`
    UPDATE scanner_devices SET last_seen_at = now()
    WHERE id = $1 AND last_seen_at < now() - interval '30 seconds'
  `, [device.id]);

  return {
    id: device.id,
    name: device.operator_name,
    anchorProgrammingId: device.programming_id,
    expiresAt: device.expires_at
  };
}

// Screenings the phone can scan right now
async function deviceScreenings(device) {
  return (await linkScreenings(device.anchorProgrammingId)).filter(isOpen);
}

async function canScan(device, programmingId) {
  return (await deviceScreenings(device)).some(s => s.id === programmingId);
}

/**
 * Phones that can scan a screening: joined through a link for it or for an earlier
 * screening in the same venue that day.
 */
async function listDevices(programmingId) {
  const { rows } = await pool.query(`
    SELECT d.id, d.operator_name, d.created_at, d.last_seen_at, d.expires_at, d.disconnected_at,
           (d.disconnected_at IS NULL AND d.expires_at > now()) AS active,
           (SELECT COUNT(*) FROM badge_scans bs WHERE bs.scanner_device_id = d.id)::int AS scans
    FROM programming_schedule x
    JOIN programming_schedule a
      ON a.edition_id = x.edition_id
     AND a.venue_id = x.venue_id
     AND a.scheduled_date = x.scheduled_date
     AND a.scheduled_time <= x.scheduled_time
    JOIN scanner_links l ON l.programming_id = a.id
    JOIN scanner_devices d ON d.link_id = l.id
    WHERE x.id = $1
    ORDER BY d.created_at
  `, [programmingId]);

  return rows.map(row => ({
    id: row.id,
    name: row.operator_name,
    joinedAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    active: row.active,
    disconnected: !!row.disconnected_at,
    scans: row.scans
  }));
}

async function disconnect(deviceId) {
  const result = await pool.query(`
    UPDATE scanner_devices SET disconnected_at = COALESCE(disconnected_at, now())
    WHERE id = $1
  `, [deviceId]);
  return result.rowCount > 0;
}

async function qrDataUrl(text) {
  const png = await bwipjs.toBuffer({ bcid: 'qrcode', text, scale: 8, eclevel: 'M', paddingwidth: 4, paddingheight: 4 });
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = {
  createLink,
  getLink,
  join,
  authenticate,
  deviceScreenings,
  canScan,
  listDevices,
  disconnect,
  qrDataUrl
};
