const cron = require('node-cron');
const goOutAPI = require('./goout-api');

/**
 * Background scheduler for GoOut token refresh
 * Refreshes tokens every 12 hours to ensure they never expire
 */
class GoOutTokenScheduler {
  constructor() {
    this.task = null;
  }

  /**
   * Start the token refresh scheduler
   * Runs every 12 hours (tokens expire in 24 hours)
   */
  start() {
    console.log('Starting GoOut token refresh scheduler...');

    // Run immediately on startup
    this.refreshTokens();

    // Schedule to run every 12 hours
    this.task = cron.schedule('0 */12 * * *', () => {
      this.refreshTokens();
    });

    console.log('✓ GoOut token refresh scheduler started (runs every 12 hours)');
  }

  /**
   * Refresh tokens
   */
  async refreshTokens() {
    try {
      console.log('[GoOut Token Scheduler] Refreshing tokens...');

      await goOutAPI.loadTokens();
      await goOutAPI.refreshAccessToken();

      console.log(`[GoOut Token Scheduler] ✓ Tokens refreshed successfully at ${new Date().toISOString()}`);
      console.log(`[GoOut Token Scheduler] Next refresh: ${new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()}`);
    } catch (error) {
      console.error('[GoOut Token Scheduler] ✗ Failed to refresh tokens:', error.message);
      // Don't crash the app, just log the error
      // The auto-refresh in goout-api.js will still work on demand
    }
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.task) {
      this.task.stop();
      console.log('GoOut token refresh scheduler stopped');
    }
  }
}

// Export singleton instance
module.exports = new GoOutTokenScheduler();
