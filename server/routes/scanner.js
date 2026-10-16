const express = require('express');
const router = express.Router();
const { pool } = require('../models/database');
const { processScan, listScans, scanLabel } = require('../services/scanning');
const scannerDevices = require('../services/scanner-devices');

// Get upcoming screenings for scanner
router.get('/screenings', async (req, res) => {
  try {
    const { edition_id } = req.query;

    if (!edition_id) {
      return res.status(400).json({ error: 'edition_id is required' });
    }

    // Get screenings that haven't finished yet (includes currently running).
    // Programme times are Prague time; comparing the end as a timestamp handles
    // screenings that end after midnight and doesn't depend on the server's time zone.
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
        AND ps.scheduled_time IS NOT NULL -- all-day events have no door to scan at
        AND ps.free_entry = false -- free events have no tickets to check
        AND ps.hidden_from_public IS NOT TRUE -- admin-only entries aren't public screenings
        AND ((ps.scheduled_date + ps.scheduled_time) AT TIME ZONE 'Europe/Prague')
              + (COALESCE(ps.total_runtime, 0) || ' minutes')::interval >= now()
      ORDER BY ps.scheduled_date ASC, ps.scheduled_time ASC
      LIMIT 50
    `;

    const result = await pool.query(query, [edition_id]);

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
    const { status, body } = await processScan({
      programming_id,
      scanned_code,
      scannedBy: req.user?.email || 'scanner-app'
    });
    res.status(status).json(body);
  } catch (error) {
    console.error('Error scanning badge:', error);
    res.status(500).json({ error: 'Failed to scan badge' });
  }
});

// Get all scanned guests for a screening
router.get('/scans/:programming_id', async (req, res) => {
  try {
    res.json({ scans: await listScans(req.params.programming_id) });
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
        bs.scanned_at AT TIME ZONE 'Europe/Prague' AS scanned_at,
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

// Get all scans for an edition (history)
router.get('/edition/:edition_id/scans', async (req, res) => {
  try {
    const { edition_id } = req.params;

    const query = `
      SELECT
        bs.id,
        bs.programming_id,
        bs.badge_number,
        bs.scanned_at AT TIME ZONE 'Europe/Prague' AS scanned_at,
        bs.scanned_by,
        bs.goout_status,
        bs.holder_name,
        bs.guest_id,
        g.first_name,
        g.last_name,
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
      LEFT JOIN guests g ON bs.guest_id = g.id
      WHERE ps.edition_id = $1
      ORDER BY bs.scanned_at DESC
    `;

    const result = await pool.query(query, [edition_id]);

    const scans = result.rows.map(row => {
      const { firstName, lastName, category } = row.guest_id
        ? { firstName: row.first_name, lastName: row.last_name }
        : scanLabel(row.badge_number, row.goout_status, row.holder_name);

      return {
        id: row.id,
        programmingId: row.programming_id,
        badgeNumber: row.badge_number,
        firstName,
        lastName,
        category,
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
      };
    });

    res.json({ scans });
  } catch (error) {
    console.error('Error fetching edition scans:', error);
    res.status(500).json({ error: 'Failed to fetch edition scans' });
  }
});

// Create a scanner link (QR code) that phones can join for a screening
router.post('/links', async (req, res) => {
  try {
    const { programming_id } = req.body;
    if (!programming_id) {
      return res.status(400).json({ error: 'programming_id is required' });
    }
    const link = await scannerDevices.createLink(programming_id, req.user?.email || null);
    if (link.error) {
      return res.status(link.status).json({ error: link.error });
    }
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${appUrl}/scan/${link.token}`;
    res.json({
      url,
      qr: await scannerDevices.qrDataUrl(url),
      joinUntil: link.joinUntil,
      screenings: link.screenings
    });
  } catch (error) {
    console.error('Error creating scanner link:', error);
    res.status(500).json({ error: 'Failed to create scanner link' });
  }
});

// Phones that can scan a screening
router.get('/devices', async (req, res) => {
  try {
    const { programming_id } = req.query;
    if (!programming_id) {
      return res.status(400).json({ error: 'programming_id is required' });
    }
    res.json({ devices: await scannerDevices.listDevices(programming_id) });
  } catch (error) {
    console.error('Error listing scanner devices:', error);
    res.status(500).json({ error: 'Failed to list scanner devices' });
  }
});

// End a phone's scanning session
router.post('/devices/:device_id/disconnect', async (req, res) => {
  try {
    const disconnected = await scannerDevices.disconnect(req.params.device_id);
    if (!disconnected) {
      return res.status(404).json({ error: 'Device not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting scanner device:', error);
    res.status(500).json({ error: 'Failed to disconnect device' });
  }
});

module.exports = router;