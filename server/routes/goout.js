const express = require('express');
const router = express.Router();
const goOutAPI = require('../services/goout-api');
const { pool } = require('../models/database');

/**
 * Get ticket counts for screenings from GoOut
 * POST /api/goout/ticket-counts
 * Body: { programming_ids: [array of programming schedule IDs] }
 * Returns: { counts: { programming_id: ticket_count }, errors: [] }
 */
router.post('/ticket-counts', async (req, res) => {
  try {
    const { programming_ids } = req.body;

    if (!programming_ids || !Array.isArray(programming_ids)) {
      return res.status(400).json({ error: 'programming_ids array is required' });
    }

    // Get GoOut sale IDs for these screenings
    const query = `
      SELECT id, goout_schedule_id
      FROM programming_schedule
      WHERE id = ANY($1)
        AND goout_schedule_id IS NOT NULL
    `;

    const result = await pool.query(query, [programming_ids]);

    // Fetch all sales to get the mapping from schedule_id to sale_id
    console.log('Fetching sales to map schedule IDs to sale IDs...');
    const allSales = await goOutAPI.getAllSales('', 10);

    // Create map of schedule_id -> sale_id
    const scheduleToSale = {};
    allSales.data.forEach(sale => {
      const scheduleId = sale.relationships?.schedule?.data?.id;
      if (scheduleId) {
        scheduleToSale[scheduleId] = sale.id;
      }
    });

    // Fetch ticket counts for each screening
    const counts = {};
    const errors = [];

    for (const row of result.rows) {
      const programmingId = row.id;
      const scheduleId = row.goout_schedule_id;
      const saleId = scheduleToSale[scheduleId];

      if (!saleId) {
        counts[programmingId] = 0;
        continue;
      }

      try {
        const purchases = await goOutAPI.apiRequest('GET', '/services/reporting/v1/purchases', null, {
          'saleIds[]': [saleId],
          'languages[]': ['cs'],
          'include': ''
        });

        // Count total tickets across all purchases
        let totalTickets = 0;
        if (purchases.purchases) {
          purchases.purchases.forEach(purchase => {
            totalTickets += purchase.attributes?.ticketCount || 0;
          });
        }
        counts[programmingId] = totalTickets;
      } catch (error) {
        console.error(`Error fetching tickets for programming ${programmingId}, sale ${saleId}:`, error.message);
        counts[programmingId] = null; // null indicates error
        errors.push({
          programming_id: programmingId,
          error: error.message
        });
      }
    }

    res.json({
      counts,
      errors,
      success: true
    });

  } catch (error) {
    console.error('Error fetching GoOut ticket counts:', error);
    // Don't fail the request - return partial data if possible
    res.status(200).json({
      counts: {},
      errors: [{ error: error.message }],
      success: false
    });
  }
});

/**
 * Get ticket count for a single screening
 * GET /api/goout/ticket-count/:programming_id
 * Returns: { count: number, success: boolean }
 */
router.get('/ticket-count/:programming_id', async (req, res) => {
  try {
    const { programming_id } = req.params;

    // Get GoOut schedule ID
    const query = `
      SELECT goout_schedule_id
      FROM programming_schedule
      WHERE id = $1
    `;

    const result = await pool.query(query, [programming_id]);

    if (result.rows.length === 0 || !result.rows[0].goout_schedule_id) {
      return res.json({ count: 0, success: true, message: 'No GoOut integration' });
    }

    const scheduleId = result.rows[0].goout_schedule_id;

    // Find the sale ID for this schedule
    const allSales = await goOutAPI.getAllSales('', 10);
    const sale = allSales.data.find(s => s.relationships?.schedule?.data?.id === scheduleId);

    if (!sale) {
      return res.json({ count: 0, success: true, message: 'Sale not found' });
    }

    // Get purchases for this sale
    const purchases = await goOutAPI.apiRequest('GET', '/services/reporting/v1/purchases', null, {
      'saleIds[]': [sale.id],
      'languages[]': ['cs'],
      'include': ''
    });

    // Count total tickets across all purchases
    let totalTickets = 0;
    if (purchases.purchases) {
      purchases.purchases.forEach(purchase => {
        totalTickets += purchase.attributes?.ticketCount || 0;
      });
    }

    res.json({
      count: totalTickets,
      success: true
    });

  } catch (error) {
    console.error('Error fetching GoOut ticket count:', error);
    // Don't fail - return 0 count
    res.json({
      count: 0,
      success: false,
      error: error.message
    });
  }
});

module.exports = router;