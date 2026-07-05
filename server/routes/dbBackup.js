/**
 * Database backups: /api/db-backup
 *
 * Backups run out-of-process in the transcode worker triggered via the storage
 * queue; the nightly scheduler enqueues one automatically in production. This
 * route only offers a manual trigger — intentionally gated on configuration,
 * not NODE_ENV, so a dev environment pointed at a test queue/Drive can
 * exercise the full path.
 */

const express = require('express');
const { logError } = require('../utils/logger');
const dbBackupQueue = require('../services/dbBackupQueue');

const router = express.Router();

// POST / — enqueue an immediate database backup.
router.post('/', async (req, res) => {
  if (!dbBackupQueue.isConfigured()) {
    return res
      .status(503)
      .json({ error: 'Backups are not configured (needs Drive + storage queue)' });
  }
  try {
    const retain = Math.max(1, parseInt(process.env.DB_BACKUP_RETENTION || '7', 10) || 7);
    await dbBackupQueue.enqueueBackup({
      retain,
      requestedBy: req.user?.email || 'manual',
    });
    res.status(202).json({ enqueued: true });
  } catch (error) {
    logError(error, { context: 'enqueue db backup' });
    res.status(500).json({ error: 'Failed to enqueue backup' });
  }
});

module.exports = router;
