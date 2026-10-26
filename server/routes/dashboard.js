const express = require('express');
const { auditMiddleware } = require('../utils/auditLogger');
const { getEditionDashboard, setManualAttendance, clearManualAttendance, DashboardError } = require('../services/edition-dashboard');

// Management dashboard (Tickets → Dashboard), see server/services/edition-dashboard.js

const router = express.Router();
const audit = auditMiddleware('dashboard');
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

// Head count of a screening entered by hand: { count, note }
router.put('/screenings/:programming_id/attendance', audit, async (req, res) => {
  if (!UUID_RE.test(req.params.programming_id)) return res.status(404).json({ error: 'Screening not found' });
  try {
    const enteredBy = req.user?.email || req.session?.user?.email || 'localhost';
    res.json({ attendance: await setManualAttendance(req.params.programming_id, req.body || {}, enteredBy) });
  } catch (error) {
    if (error instanceof DashboardError) return res.status(error.status).json({ error: error.message });
    console.error('Dashboard: save head count failed:', error);
    res.status(500).json({ error: 'Failed to save the head count' });
  }
});

router.delete('/screenings/:programming_id/attendance', audit, async (req, res) => {
  if (!UUID_RE.test(req.params.programming_id)) return res.status(404).json({ error: 'Screening not found' });
  try {
    res.json({ removed: await clearManualAttendance(req.params.programming_id) });
  } catch (error) {
    console.error('Dashboard: remove head count failed:', error);
    res.status(500).json({ error: 'Failed to remove the head count' });
  }
});

module.exports = router;
