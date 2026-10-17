const express = require('express');
const router = express.Router();
const { getEditionPresale } = require('../services/goout-presale');
const accreditations = require('../services/goout-accreditations');
const { auditMiddleware } = require('../utils/auditLogger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Wrap an accreditations handler: AccreditationError becomes its HTTP status, anything else a 500
const handleAccreditations = (label, fn) => async (req, res) => {
  if (!UUID_RE.test(req.params.edition_id)) return res.status(404).json({ error: 'Edition not found' });
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof accreditations.AccreditationError) {
      return res.status(error.status).json({ error: error.message, ...error.extra });
    }
    console.error(`GoOut accreditations: ${label} failed:`, error);
    res.status(500).json({ error: `Failed to ${label}` });
  }
};

/**
 * Presale overview of an edition
 * GET /api/goout/presale/:edition_id?refresh=1
 * refresh=1 reloads running sales from GoOut instead of using the 5-minute cache.
 */
router.get('/presale/:edition_id', async (req, res) => {
  try {
    const presale = await getEditionPresale(req.params.edition_id, { refresh: req.query.refresh === '1' });
    if (!presale) {
      return res.status(404).json({ error: 'Edition not found' });
    }
    res.json(presale);
  } catch (error) {
    console.error('Error building GoOut presale overview:', error);
    res.status(502).json({ error: `GoOut presale data unavailable: ${error.message}` });
  }
});

/**
 * Festival passes bought on GoOut with their conversions to our badges
 * GET /api/goout/accreditations/:edition_id
 */
router.get('/accreditations/:edition_id', handleAccreditations('load accreditations', async (req, res) => {
  res.json(await accreditations.listAccreditations(req.params.edition_id));
}));

/**
 * Convert a GoOut pass to a guest with a badge (one badge per pass)
 * POST /api/goout/accreditations/:edition_id/convert
 * { ticket_id, first_name, last_name, email?, phone?, language?, guest_id? }
 */
router.post('/accreditations/:edition_id/convert', auditMiddleware('goout_accreditations'),
  handleAccreditations('convert accreditation', async (req, res) => {
    const { ticket_id, first_name, last_name, email, phone, language, guest_id } = req.body || {};
    if (guest_id && !UUID_RE.test(guest_id)) return res.status(400).json({ error: 'Invalid guest_id' });
    const result = await accreditations.convertAccreditation({
      editionId: req.params.edition_id,
      ticketId: ticket_id,
      firstName: first_name,
      lastName: last_name,
      email,
      phone,
      language,
      guestId: guest_id || null,
      convertedBy: req.user?.email || null
    });
    res.status(201).json(result);
  }));

module.exports = router;
