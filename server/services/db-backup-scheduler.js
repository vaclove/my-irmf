const cron = require('node-cron');
const dbBackupQueue = require('./dbBackupQueue');
const { logger } = require('../utils/logger');

/**
 * Daily database backup scheduler. Only enqueues a db_backup message on the
 * storage queue — the actual pg_dump + Drive upload runs in the out-of-process
 * worker. Production-only by default: DB_BACKUP_ENABLED=true force-enables in
 * dev, DB_BACKUP_ENABLED=false disables everywhere. The cron fires in
 * Europe/Prague (App Service runs UTC) so "3 AM" means festival-local time.
 */
class DbBackupScheduler {
  constructor() {
    this.task = null;
  }

  start() {
    if (process.env.DB_BACKUP_ENABLED === 'false') {
      console.log('DB backup scheduler disabled (DB_BACKUP_ENABLED=false)');
      return;
    }
    const enabled =
      process.env.NODE_ENV === 'production' || process.env.DB_BACKUP_ENABLED === 'true';
    if (!enabled) {
      console.log('DB backup scheduler not started (non-production)');
      return;
    }
    if (!dbBackupQueue.isConfigured()) {
      console.log('DB backup scheduler not started (queue/Drive not configured)');
      return;
    }

    const schedule = process.env.DB_BACKUP_CRON || '0 3 * * *';
    if (!cron.validate(schedule)) {
      console.error(`Invalid DB_BACKUP_CRON "${schedule}"; scheduler not started`);
      return;
    }

    this.task = cron.schedule(schedule, () => this.enqueue(), {
      timezone: process.env.DB_BACKUP_TZ || 'Europe/Prague',
    });
    console.log(`✓ DB backup scheduler started (cron: ${schedule})`);
  }

  async enqueue() {
    try {
      const retain = Math.max(1, parseInt(process.env.DB_BACKUP_RETENTION || '7', 10) || 7);
      await dbBackupQueue.enqueueBackup({ retain, requestedBy: 'scheduler' });
      logger.info('[DbBackupScheduler] backup message enqueued', { retain });
    } catch (error) {
      logger.error('[DbBackupScheduler] enqueue failed', { error: error.message });
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log('DB backup scheduler stopped');
    }
  }
}

module.exports = new DbBackupScheduler();
