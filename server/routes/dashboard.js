const express = require('express');
const { getEditionDashboard } = require('../services/edition-dashboard');

// Management dashboard (Tickets → Dashboard), see server/services/edition-dashboard.js

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every ticketing channel and the door of an edition
 * GET /api/dashboard/:edition_id?refresh=1
 * refresh=1 reloads running GoOut sales instead of the 5-minute cache.
 */
router.get('/:edition_id', async (req, res) => {
  if (!UUID_RE.test(req.params.edition_id)) return res.status(404).json({ error: 'Edition not found' });
  try {
    const dashboard = await getEditionDashboard(req.params.edition_id, { refresh: req.query.refresh === '1' });
    if (!dashboard) return res.status(404).json({ error: 'Edition not found' });
    res.json(dashboard);
  } catch (error) {
    console.error('Dashboard: load failed:', error);
    res.status(500).json({ error: 'Failed to load the dashboard' });
  }
});

module.exports = router;
