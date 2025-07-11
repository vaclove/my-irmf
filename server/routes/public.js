const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const router = express.Router();

// Confirm invitation - public route (no authentication required)
router.post('/invitations/confirm/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Find assignment by token
    const result = await pool.query(`
      SELECT ge.*, g.name, g.email, e.name as edition_name
      FROM guest_editions ge
      JOIN guests g ON ge.guest_id = g.id
      JOIN editions e ON ge.edition_id = e.id
      WHERE ge.confirmation_token = $1 AND ge.confirmed_at IS NULL
    `, [token]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or already used confirmation token' });
    }
    
    // Update confirmation
    await pool.query(
      'UPDATE guest_editions SET confirmed_at = CURRENT_TIMESTAMP WHERE confirmation_token = $1',
      [token]
    );
    
    const assignment = result.rows[0];
    
    res.json({
      message: 'Invitation confirmed successfully',
      guest: assignment.name,
      edition: assignment.edition_name,
      category: assignment.category,
      confirmed_at: new Date().toISOString()
    });
    
  } catch (error) {
    logError(error, req, { operation: 'confirm_invitation', token: req.params.token });
    res.status(500).json({ error: error.message });
  }
});

// Get invitation status - public route
router.get('/invitations/status/:guest_id/:edition_id', async (req, res) => {
  try {
    const { guest_id, edition_id } = req.params;
    
    const result = await pool.query(`
      SELECT ge.invited_at, ge.confirmed_at, ge.confirmation_token,
             g.name, g.email, e.name as edition_name
      FROM guest_editions ge
      JOIN guests g ON ge.guest_id = g.id
      JOIN editions e ON ge.edition_id = e.id
      WHERE ge.guest_id = $1 AND ge.edition_id = $2
    `, [guest_id, edition_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    
    const assignment = result.rows[0];
    
    res.json({
      guest: assignment.name,
      email: assignment.email,
      edition: assignment.edition_name,
      invited_at: assignment.invited_at,
      confirmed_at: assignment.confirmed_at,
      status: assignment.confirmed_at ? 'confirmed' : assignment.invited_at ? 'invited' : 'not_invited'
    });
    
  } catch (error) {
    logError(error, req, { operation: 'get_invitation_status', guestId: req.params.guest_id, editionId: req.params.edition_id });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;