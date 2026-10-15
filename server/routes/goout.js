const express = require('express');
const router = express.Router();
const { getEditionPresale, getTicketCounts } = require('../services/goout-presale');

/**
 * Get ticket counts for screenings from GoOut
 * POST /api/goout/ticket-counts
 * Body: { programming_ids: [array of programming schedule IDs] }
 * Returns: { counts: { programming_id: ticket_count }, errors: [] }
 * A count is the number of valid (paid) tickets, including free ones; null means GoOut failed.
 */
router.post('/ticket-counts', async (req, res) => {
  try {
    const { programming_ids } = req.body;

    if (!programming_ids || !Array.isArray(programming_ids)) {
      return res.status(400).json({ error: 'programming_ids array is required' });
    }

    const { counts, errors } = await getTicketCounts(programming_ids);
    res.json({ counts, errors, success: true });

  } catch (error) {
    console.error('Error fetching GoOut ticket counts:', error);
    // Don't fail the request - return partial data if possible
    res.status(200).json({
      counts: {},
      errors: [{ error: error.message }],
      success: false
    });
  }
});

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

module.exports = router;
