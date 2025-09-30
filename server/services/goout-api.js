const axios = require('axios');
const { pool } = require('../models/database');

const GOOUT_BASE_URL = 'https://goout.net';

class GoOutAPI {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
    this.refreshExpiresAt = null;
  }

  /**
   * Load tokens from database
   */
  async loadTokens() {
    try {
      const result = await pool.query(`
        SELECT access_token, refresh_token, expires_at, refresh_expires_at
        FROM goout_tokens
        ORDER BY id DESC
        LIMIT 1
      `);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        this.accessToken = row.access_token;
        this.refreshToken = row.refresh_token;
        this.expiresAt = new Date(row.expires_at);
        this.refreshExpiresAt = new Date(row.refresh_expires_at);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error loading GoOut tokens:', error);
      throw error;
    }
  }

  /**
   * Save tokens to database
   */
  async saveTokens(accessToken, refreshToken, accessExpiresIn = 86400, refreshExpiresIn = 5184000) {
    try {
      // accessExpiresIn is in seconds (default 24 hours = 86400)
      // refreshExpiresIn is in seconds (default 60 days = 5184000)

      const expiresAt = new Date(Date.now() + accessExpiresIn * 1000);
      const refreshExpiresAt = new Date(Date.now() + refreshExpiresIn * 1000);

      await pool.query(`
        DELETE FROM goout_tokens
      `);

      await pool.query(`
        INSERT INTO goout_tokens (access_token, refresh_token, expires_at, refresh_expires_at)
        VALUES ($1, $2, $3, $4)
      `, [accessToken, refreshToken, expiresAt, refreshExpiresAt]);

      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      this.expiresAt = expiresAt;
      this.refreshExpiresAt = refreshExpiresAt;
    } catch (error) {
      console.error('Error saving GoOut tokens:', error);
      throw error;
    }
  }

  /**
   * Check if access token needs refresh (expires in less than 1 hour)
   */
  needsRefresh() {
    if (!this.expiresAt) return true;
    const oneHourFromNow = new Date(Date.now() + 3600 * 1000);
    return this.expiresAt < oneHourFromNow;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    try {
      console.log('Refreshing GoOut access token...');

      const response = await axios.post(
        `${GOOUT_BASE_URL}/services/user/v3/refresh-tokens?refreshToken=${this.refreshToken}`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const { accessToken, refreshToken } = response.data;

      // If refresh token changed, update it (as per API docs)
      const newRefreshToken = refreshToken || this.refreshToken;

      await this.saveTokens(accessToken, newRefreshToken);

      console.log('GoOut access token refreshed successfully');
      return true;
    } catch (error) {
      console.error('Error refreshing GoOut access token:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Ensure we have a valid access token
   */
  async ensureValidToken() {
    if (!this.accessToken) {
      await this.loadTokens();
    }

    if (this.needsRefresh()) {
      await this.refreshAccessToken();
    }
  }

  /**
   * Make authenticated API request to GoOut
   */
  async apiRequest(method, path, data = null, params = {}) {
    await this.ensureValidToken();

    try {
      const config = {
        method,
        url: `${GOOUT_BASE_URL}${path}`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        params
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      // If token is invalid, try refreshing once
      if (error.response?.status === 401) {
        console.log('Token invalid, attempting refresh...');
        await this.refreshAccessToken();

        // Retry request with new token
        const config = {
          method,
          url: `${GOOUT_BASE_URL}${path}`,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          params
        };

        if (data) {
          config.data = data;
        }

        const response = await axios(config);
        return response.data;
      }

      throw error;
    }
  }

  /**
   * Search for purchases by barcode or query
   * @param {string} query - Search query (barcode, email, name, etc.)
   * @param {string} language - Language code (cs, en, pl, etc.)
   * @param {Array<string>} include - Entities to include (events, sales, tickets, etc.)
   */
  async searchPurchases(query, language = 'cs', include = ['tickets', 'events', 'schedules', 'deals']) {
    return await this.apiRequest('GET', '/services/reporting/v1/purchases', null, {
      query,
      'languages[]': [language],
      include: include.join(',')
    });
  }

  /**
   * Get purchase by barcode
   * @param {string} barcode - Ticket barcode
   * @param {string} language - Language code
   */
  async getPurchaseByBarcode(barcode, language = 'cs') {
    const result = await this.searchPurchases(barcode, language);
    return result;
  }

  /**
   * Check-in a ticket
   * @param {string} barcode - Ticket barcode
   * @param {number} checkInId - Check-in setup ID
   * @param {string} language - Language code
   */
  async checkInTicket(barcode, checkInId, language = 'cs') {
    return await this.apiRequest('POST', '/services/entitystore/v2/checkin-entries', {
      barCodeId: barcode,
      checkInId: checkInId
    }, {
      language
    });
  }

  /**
   * Get sales information
   * @param {Array<number>} saleIds - Array of sale IDs
   * @param {string} include - Comma-separated list of entities to include
   * @param {number} pageIndex - Page number (0-indexed)
   * @param {number} pageSize - Number of results per page (default 50, max likely 100)
   */
  async getSales(saleIds = [], include = 'deals,discounts,schedules,events', pageIndex = 0, pageSize = 50) {
    const params = {
      include,
      pageIndex,
      pageSize
    };

    // Only include ids[] if saleIds are provided
    if (saleIds && saleIds.length > 0) {
      params['ids[]'] = saleIds;
    }

    return await this.apiRequest('GET', '/services/entitystore/v2/sales', null, params);
  }

  /**
   * Get ALL sales with pagination (fetches all pages)
   * @param {string} include - Comma-separated list of entities to include
   * @param {number} maxPages - Maximum number of pages to fetch (safety limit)
   */
  async getAllSales(include = 'deals', maxPages = 10) {
    const allSales = [];
    let pageIndex = 0;
    let hasMore = true;

    while (hasMore && pageIndex < maxPages) {
      const response = await this.getSales([], include, pageIndex, 50);

      if (response.data && response.data.length > 0) {
        allSales.push(...response.data);
        pageIndex++;

        // If we got less than 50, we've reached the end
        if (response.data.length < 50) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    return {
      data: allSales,
      totalPages: pageIndex,
      totalSales: allSales.length
    };
  }
}

// Singleton instance
const goOutAPI = new GoOutAPI();

module.exports = goOutAPI;