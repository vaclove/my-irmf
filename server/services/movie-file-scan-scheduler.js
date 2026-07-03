const cron = require('node-cron');
const googleDrive = require('./googleDrive');
const movieFileScanner = require('./movieFileScanner');
const { logger } = require('../utils/logger');

/**
 * Background scheduler that periodically reconciles each movie's Drive folder
 * with the movie_files pointer rows, so files added/removed directly in Drive
 * are reflected in the app. Disabled when MOVIE_SCAN_ENABLED === 'false' or
 * when Google Drive is not configured. Does NOT scan on boot.
 */
class MovieFileScanScheduler {
  constructor() {
    this.task = null;
    this.isRunning = false;
  }

  start() {
    if (process.env.MOVIE_SCAN_ENABLED === 'false') {
      console.log('Movie file scan scheduler disabled (MOVIE_SCAN_ENABLED=false)');
      return;
    }
    if (!googleDrive.isConfigured()) {
      console.log('Movie file scan scheduler not started (Google Drive not configured)');
      return;
    }

    const schedule = process.env.MOVIE_SCAN_CRON || '*/45 * * * *';
    if (!cron.validate(schedule)) {
      console.error(`Invalid MOVIE_SCAN_CRON "${schedule}"; scheduler not started`);
      return;
    }

    this.task = cron.schedule(schedule, () => {
      this.runScan();
    });
    console.log(`✓ Movie file scan scheduler started (cron: ${schedule})`);
  }

  async runScan() {
    // Skip if a previous scan is still running (a full scan can exceed the
    // cron interval); prevents overlapping concurrent scans.
    if (this.isRunning) {
      logger.warn('[MovieScanScheduler] Previous scan still running; skipping this tick');
      return;
    }
    this.isRunning = true;
    try {
      logger.info('[MovieScanScheduler] Starting scheduled scan');
      const result = await movieFileScanner.scanAll();
      logger.info('[MovieScanScheduler] Scan finished', result);
    } catch (error) {
      logger.error('[MovieScanScheduler] Scan failed', { error: error.message });
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log('Movie file scan scheduler stopped');
    }
  }
}

module.exports = new MovieFileScanScheduler();
