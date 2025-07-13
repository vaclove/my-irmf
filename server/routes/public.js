const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const router = express.Router();

// Confirm invitation - public route (no authentication required)
router.post('/confirm/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Find invitation by token
    const result = await pool.query(`
      SELECT gi.*, g.first_name || ' ' || g.last_name as name, g.email, e.name as edition_name,
             COALESCE(
               (SELECT tag_name FROM (
                 SELECT t2.name as tag_name, 
                        CASE t2.name 
                          WHEN 'filmmaker' THEN 1
                          WHEN 'press' THEN 2  
                          WHEN 'staff' THEN 3
                          WHEN 'guest' THEN 4
                          ELSE 5
                        END as priority
                 FROM guest_tags gt2 
                 JOIN tags t2 ON gt2.tag_id = t2.id 
                 WHERE gt2.guest_id = g.id 
                 AND t2.name IN ('filmmaker', 'press', 'staff', 'guest')
                 ORDER BY priority
                 LIMIT 1
               ) sub),
               'guest'
             ) as category
      FROM guest_invitations gi
      JOIN guests g ON gi.guest_id = g.id
      JOIN editions e ON gi.edition_id = e.id
      WHERE gi.token = $1 AND gi.confirmed_at IS NULL
    `, [token]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or already used confirmation token' });
    }
    
    // Update confirmation
    await pool.query(
      'UPDATE guest_invitations SET confirmed_at = CURRENT_TIMESTAMP WHERE token = $1',
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
router.get('/status/:guest_id/:edition_id', async (req, res) => {
  try {
    const { guest_id, edition_id } = req.params;
    
    const result = await pool.query(`
      SELECT gi.invited_at, gi.confirmed_at, gi.token,
             g.first_name || ' ' || g.last_name as name, g.email, e.name as edition_name
      FROM guest_invitations gi
      JOIN guests g ON gi.guest_id = g.id
      JOIN editions e ON gi.edition_id = e.id
      WHERE gi.guest_id = $1 AND gi.edition_id = $2
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