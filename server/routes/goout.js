const express = require('express');
const router = express.Router();
const { getEditionPresale } = require('../services/goout-presale');

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
