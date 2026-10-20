const express = require('express');
const qlab = require('../services/qlab');

// Live projection status for the programme's QLab tab (server/services/qlab.js).
// The client only ever sees this trimmed copy, never the token or headers.
const router = express.Router();

router.get('/status', async (req, res) => {
  const snapshot = await qlab.getStatus();
  const { fetchedAt, ...rest } = snapshot;
  // Age instead of a timestamp, so the client clock does not matter
  res.json({ ...rest, ageMs: Math.max(0, Date.now() - fetchedAt), snapshotAgeMs: qlab.snapshotAgeMs() });
});

// Projector frame (640×360 JPEG), refreshed at most every 10 s
router.get('/snapshot.jpg', async (req, res) => {
  const frame = await qlab.getSnapshot();
  if (!frame) return res.status(404).json({ error: 'No snapshot available' });
  res.type('image/jpeg').set('Content-Length', String(frame.jpeg.length)).send(frame.jpeg);
});

router.get('/cuelists', async (req, res) => {
  const { state, stale = false, cueLists = null } = await qlab.getCuelists();
  res.json({ state, stale, cueLists });
});

module.exports = router;
