const express = require('express');
const router = express.Router();
const { pool } = require('../models/database');

// Get upcoming screenings for scanner
router.get('/screenings', async (req, res) => {
  try {
    const { edition_id } = req.query;

    if (!edition_id) {
      return res.status(400).json({ error: 'edition_id is required' });
    }

    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);

    // Get screenings for the edition that haven't passed yet
    const query = `
      SELECT
        ps.id,
        ps.scheduled_date,
        ps.scheduled_time,
        ps.total_runtime,
        ps.title_override_cs,
        ps.title_override_en,
        v.name_cs as venue_name_cs,
        v.name_en as venue_name_en,
        m.name_cs as movie_name_cs,
        m.name_en as movie_name_en,
        mb.name_cs as block_name_cs,
        mb.name_en as block_name_en,
        (SELECT COUNT(*) FROM badge_scans WHERE programming_id = ps.id) as scan_count
      FROM programming_schedule ps
      JOIN venues v ON ps.venue_id = v.id
      LEFT JOIN movies m ON ps.movie_id = m.id
      LEFT JOIN movie_blocks mb ON ps.block_id = mb.id
      WHERE ps.edition_id = $1
        AND (
          ps.scheduled_date > $2
          OR (ps.scheduled_date = $2 AND ps.scheduled_time >= $3)
        )
      ORDER BY ps.scheduled_date ASC, ps.scheduled_time ASC
      LIMIT 50
    `;

    const result = await pool.query(query, [edition_id, currentDate, currentTime]);

    // Format the response
    const screenings = result.rows.map(row => ({
      id: row.id,
      date: row.scheduled_date,
      time: row.scheduled_time,
      runtime: row.total_runtime,
      venue: {
        cs: row.venue_name_cs,
        en: row.venue_name_en
      },
      title: {
        cs: row.title_override_cs || row.movie_name_cs || row.block_name_cs,
        en: row.title_override_en || row.movie_name_en || row.block_name_en
      },
      scanCount: parseInt(row.scan_count) || 0
    }));

    res.json({ screenings });
  } catch (error) {
    console.error('Error fetching screenings:', error);
    res.status(500).json({ error: 'Failed to fetch screenings' });
  }
});

// Scan a badge for a screening
router.post('/scan', async (req, res) => {
  try {
    const { programming_id, scanned_code } = req.body;

    if (!programming_id || !scanned_code) {
      return res.status(400).json({ error: 'programming_id and scanned_code are required' });
    }

    // Extract badge information based on scanned code format
    // Our format: YYYY### (length 7) - e.g., 2025003
    // External format: anything else - e.g., 1400528549781 (13 digits)

    const scannedStr = String(scanned_code);
    let badgeNumber = null;
    let isInternalBadge = false;

    if (scannedStr.length === 7) {
      // Our internal badge format: extract last 3 digits
      badgeNumber = parseInt(scannedStr.slice(-3));
      isInternalBadge = !isNaN(badgeNumber);
    }

    const badgeIdentifier = isInternalBadge ? badgeNumber : scannedStr;

    let guest = null;
    let guestId = null;

    if (isInternalBadge) {
      // Look up internal guest by badge number
      const guestQuery = `
        SELECT
          g.id as guest_id,
          g.first_name,
          g.last_name,
          gbn.badge_number,
          gbn.edition_id
        FROM guests g
        JOIN guest_badge_numbers gbn ON g.id = gbn.guest_id
        WHERE gbn.badge_number = $1
      `;

      const guestResult = await pool.query(guestQuery, [badgeNumber]);

      if (guestResult.rows.length === 0) {
        return res.status(404).json({ error: 'Badge number not found' });
      }

      guest = guestResult.rows[0];
      guestId = guest.guest_id;
    } else {
      // External badge - no validation, allow scanning
      guestId = null;
    }

    // Check if already scanned
    const existingQuery = isInternalBadge
      ? `SELECT id FROM badge_scans WHERE programming_id = $1 AND guest_id = $2`
      : `SELECT id FROM badge_scans WHERE programming_id = $1 AND badge_number = $2`;

    const existingResult = await pool.query(existingQuery,
      isInternalBadge ? [programming_id, guestId] : [programming_id, String(badgeIdentifier)]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({
        error: 'Badge already scanned for this screening',
        guest: guest ? {
          firstName: guest.first_name,
          lastName: guest.last_name,
          badgeNumber: guest.badge_number
        } : {
          firstName: 'External',
          lastName: 'Guest',
          badgeNumber: badgeIdentifier
        }
      });
    }

    // Insert scan record
    const insertQuery = `
      INSERT INTO badge_scans (programming_id, guest_id, badge_number, scanned_by)
      VALUES ($1, $2, $3, $4)
      RETURNING id, scanned_at
    `;

    const insertResult = await pool.query(insertQuery, [
      programming_id,
      guestId,
      String(badgeIdentifier),
      req.user?.email || 'scanner-app'
    ]);

    // Get updated scan count
    const countQuery = `
      SELECT COUNT(*) as count FROM badge_scans
      WHERE programming_id = $1
    `;

    const countResult = await pool.query(countQuery, [programming_id]);

    res.json({
      success: true,
      guest: guest ? {
        firstName: guest.first_name,
        lastName: guest.last_name,
        badgeNumber: guest.badge_number
      } : {
        firstName: 'External',
        lastName: 'Guest',
        badgeNumber: badgeIdentifier
      },
      scannedAt: insertResult.rows[0].scanned_at,
      totalScans: parseInt(countResult.rows[0].count)
    });
  } catch (error) {
    console.error('Error scanning badge:', error);
    res.status(500).json({ error: 'Failed to scan badge' });
  }
});

// Get all scanned guests for a screening
router.get('/scans/:programming_id', async (req, res) => {
  try {
    const { programming_id } = req.params;

    const query = `
      SELECT
        bs.id,
        bs.badge_number,
        bs.scanned_at,
        bs.scanned_by,
        g.first_name,
        g.last_name
      FROM badge_scans bs
      JOIN guests g ON bs.guest_id = g.id
      WHERE bs.programming_id = $1
      ORDER BY bs.scanned_at DESC
    `;

    const result = await pool.query(query, [programming_id]);

    const scans = result.rows.map(row => ({
      id: row.id,
      badgeNumber: row.badge_number,
      firstName: row.first_name,
      lastName: row.last_name,
      scannedAt: row.scanned_at,
      scannedBy: row.scanned_by
    }));

    res.json({ scans });
  } catch (error) {
    console.error('Error fetching scans:', error);
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

// Delete a scan
router.delete('/scans/:scan_id', async (req, res) => {
  try {
    const { scan_id } = req.params;

    const query = `
      DELETE FROM badge_scans
      WHERE id = $1
      RETURNING id
    `;

    const result = await pool.query(query, [scan_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting scan:', error);
    res.status(500).json({ error: 'Failed to delete scan' });
  }
});

// Get all scans for a specific badge (by guest ID)
router.get('/badge/:guest_id/scans', async (req, res) => {
  try {
    const { guest_id } = req.params;

    const query = `
      SELECT
        bs.id,
        bs.programming_id,
        bs.badge_number,
        bs.scanned_at,
        bs.scanned_by,
        ps.scheduled_date,
        ps.scheduled_time,
        ps.title_override_cs,
        ps.title_override_en,
        v.name_cs as venue_name_cs,
        v.name_en as venue_name_en,
        m.name_cs as movie_name_cs,
        m.name_en as movie_name_en,
        mb.name_cs as block_name_cs,
        mb.name_en as block_name_en
      FROM badge_scans bs
      JOIN programming_schedule ps ON bs.programming_id = ps.id
      JOIN venues v ON ps.venue_id = v.id
      LEFT JOIN movies m ON ps.movie_id = m.id
      LEFT JOIN movie_blocks mb ON ps.block_id = mb.id
      WHERE bs.guest_id = $1
      ORDER BY bs.scanned_at DESC
    `;

    const result = await pool.query(query, [guest_id]);

    const scans = result.rows.map(row => ({
      id: row.id,
      programmingId: row.programming_id,
      badgeNumber: row.badge_number,
      scannedAt: row.scanned_at,
      scannedBy: row.scanned_by,
      screening: {
        date: row.scheduled_date,
        time: row.scheduled_time,
        venue: {
          cs: row.venue_name_cs,
          en: row.venue_name_en
        },
        title: {
          cs: row.title_override_cs || row.movie_name_cs || row.block_name_cs,
          en: row.title_override_en || row.movie_name_en || row.block_name_en
        }
      }
    }));

    res.json({ scans });
  } catch (error) {
    console.error('Error fetching badge scans:', error);
    res.status(500).json({ error: 'Failed to fetch badge scans' });
  }
});

module.exports = router;