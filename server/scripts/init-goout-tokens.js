require('dotenv').config();
const { pool } = require('../models/database');

/**
 * Initialize GoOut tokens in database
 * Run this script once to populate tokens in Azure database:
 * node server/scripts/init-goout-tokens.js <access_token> <refresh_token>
 */
async function initTokens() {
  try {
    const accessToken = process.argv[2];
    const refreshToken = process.argv[3];

    if (!accessToken || !refreshToken) {
      console.error('Usage: node init-goout-tokens.js <access_token> <refresh_token>');
      process.exit(1);
    }

    // GoOut tokens expire in 24 hours (access) and 60 days (refresh)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
    const refreshExpiresAt = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days

    // Delete existing tokens (if any)
    await pool.query('DELETE FROM goout_tokens');

    // Insert new tokens
    await pool.query(
      `INSERT INTO goout_tokens (access_token, refresh_token, expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4)`,
      [accessToken, refreshToken, expiresAt, refreshExpiresAt]
    );

    console.log('✓ GoOut tokens initialized successfully');
    console.log(`  Access token expires: ${expiresAt.toISOString()}`);
    console.log(`  Refresh token expires: ${refreshExpiresAt.toISOString()}`);

    process.exit(0);
  } catch (error) {
    console.error('Error initializing tokens:', error);
    process.exit(1);
  }
}

initTokens();