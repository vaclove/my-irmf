const express = require('express');
const router = express.Router();
const scannerDevices = require('../services/scanner-devices');
const { processScan, listScans } = require('../services/scanning');
const { rateLimit } = require('../utils/rateLimit');

/**
 * Scanner for phones that joined through a scanner link (no login).
 * See services/scanner-devices.js. Phones send their session key as
 * "Authorization: Bearer <key>"; they can't remove scans.
 */

const sessionKey = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '');

// Joining is per IP; scanning per phone (phones at one door may share an IP)
const joinLimit = rateLimit({ windowMs: 60 * 1000, max: 20, key: req => req.ip });
const deviceLimit = rateLimit({ windowMs: 60 * 1000, max: 120, key: req => sessionKey(req) || req.ip });

// What a link is for, before joining
router.get('/join/:token', joinLimit, async (req, res) => {
  try {
    const link = await scannerDevices.getLink(req.params.token);
    if (!link) {
      return res.status(404).json({ error: 'This scanner code is not valid' });
    }
    res.json(link);
  } catch (error) {
    console.error('Error reading scanner link:', error);
    res.status(500).json({ error: 'Failed to read scanner code' });
  }
});

// Join with an operator name; returns the phone's session key
router.post('/join/:token', joinLimit, async (req, res) => {
  try {
    const result = await scannerDevices.join(req.params.token, req.body?.name, req.get('user-agent'));
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Error joining scanner link:', error);
    res.status(500).json({ error: 'Failed to join' });
  }
});

// Everything below needs a running phone session
router.use(deviceLimit, async (req, res, next) => {
  try {
    const device = await scannerDevices.authenticate(sessionKey(req));
    if (!device) {
      return res.status(401).json({ error: 'Scanning session ended' });
    }
    req.device = device;
    next();
  } catch (error) {
    console.error('Error checking scanner session:', error);
    res.status(500).json({ error: 'Failed to check scanner session' });
  }
});

router.get('/me', (req, res) => {
  res.json({ name: req.device.name, expiresAt: req.device.expiresAt });
});

router.get('/screenings', async (req, res) => {
  try {
    res.json({ screenings: await scannerDevices.deviceScreenings(req.device) });
  } catch (error) {
    console.error('Error fetching phone screenings:', error);
    res.status(500).json({ error: 'Failed to load screenings' });
  }
});

router.get('/scans/:programming_id', async (req, res) => {
  try {
    if (!(await scannerDevices.canScan(req.device, req.params.programming_id))) {
      return res.status(403).json({ error: 'This phone cannot scan this screening' });
    }
    res.json({ scans: await listScans(req.params.programming_id) });
  } catch (error) {
    console.error('Error fetching phone scans:', error);
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

router.post('/scan', async (req, res) => {
  try {
    const { programming_id, scanned_code } = req.body;
    if (!(await scannerDevices.canScan(req.device, programming_id))) {
      return res.status(403).json({ error: 'This phone cannot scan this screening' });
    }
    const { status, body } = await processScan({
      programming_id,
      scanned_code,
      scannedBy: `${req.device.name} (phone)`,
      scannerDeviceId: req.device.id
    });
    res.status(status).json(body);
  } catch (error) {
    console.error('Error scanning on phone:', error);
    res.status(500).json({ error: 'Failed to scan badge' });
  }
});

module.exports = router;
