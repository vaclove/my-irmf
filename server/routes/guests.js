const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware, captureOriginalData } = require('../utils/auditLogger');
const router = express.Router();

// Apply audit middleware to all routes
router.use(auditMiddleware('guests'));
router.use(captureOriginalData('guests'));

// Get all guests
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*,
             COALESCE(
               JSON_AGG(
                 JSON_BUILD_OBJECT(
                   'id', t.id,
                   'name', t.name,
                   'color', t.color
                 ) ORDER BY t.name
               ) FILTER (WHERE t.id IS NOT NULL),
               '[]'::json
             ) as tags
      FROM guests g
      LEFT JOIN guest_tags gt ON g.id = gt.guest_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      GROUP BY g.id
      ORDER BY g.first_name, g.last_name
    `);
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_all_guests' });
    res.status(500).json({ error: error.message });
  }
});

// Get guest by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT g.*,
             COALESCE(
               JSON_AGG(
                 JSON_BUILD_OBJECT(
                   'id', t.id,
                   'name', t.name,
                   'color', t.color
                 ) ORDER BY t.name
               ) FILTER (WHERE t.id IS NOT NULL),
               '[]'::json
             ) as tags
      FROM guests g
      LEFT JOIN guest_tags gt ON g.id = gt.guest_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      WHERE g.id = $1
      GROUP BY g.id
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Guest not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'get_guest_by_id', guestId: id });
    res.status(500).json({ error: error.message });
  }
});

// Create new guest
router.post('/', async (req, res) => {
  try {
    const { first_name, last_name, email, phone, language, company, notes } = req.body;
    
    if (!first_name || !last_name || !email) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }
    
    // Validate language if provided
    if (language && !['czech', 'english'].includes(language)) {
      return res.status(400).json({ error: 'Language must be either "czech" or "english"' });
    }
    
    const result = await pool.query(
      `INSERT INTO guests (first_name, last_name, email, phone, language, company, notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [first_name, last_name, email, phone, language || 'english', company, notes]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    logError(error, req, { operation: 'create_guest', formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Update guest
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, language, company, notes } = req.body;
    
    // Validate language if provided
    if (language && !['czech', 'english'].includes(language)) {
      return res.status(400).json({ error: 'Language must be either "czech" or "english"' });
    }
    
    const result = await pool.query(
      `UPDATE guests SET 
       first_name = $1, 
       last_name = $2, 
       email = $3, 
       phone = $4, 
       language = $5, 
       company = $6, 
       notes = $7, 
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $8 
       RETURNING *`,
      [first_name, last_name, email, phone, language, company, notes, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Guest not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'update_guest', guestId: req.params.id, formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Delete guest
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM guests WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Guest not found' });
    }
    
    res.json({ message: 'Guest deleted successfully' });
  } catch (error) {
    logError(error, req, { operation: 'delete_guest', guestId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// Get guest assignments for a specific edition
router.get('/:id/editions/:editionId', async (req, res) => {
  try {
    const { id, editionId } = req.params;
    
    const result = await pool.query(`
      SELECT ge.*, e.name as edition_name, e.year 
      FROM guest_editions ge
      JOIN editions e ON ge.edition_id = e.id
      WHERE ge.guest_id = $1 AND ge.edition_id = $2
    `, [id, editionId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'get_guest_edition_assignment', guestId: req.params.id, editionId: req.params.editionId });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;