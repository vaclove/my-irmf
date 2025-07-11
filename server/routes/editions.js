const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const router = express.Router();

// Get all editions
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM editions ORDER BY year DESC');
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_all_editions' });
    res.status(500).json({ error: error.message });
  }
});

// Get edition by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM editions WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Edition not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'get_edition_by_id', editionId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// Create new edition
router.post('/', async (req, res) => {
  try {
    const { year, name, start_date, end_date } = req.body;
    
    if (!year || !name) {
      return res.status(400).json({ error: 'Year and name are required' });
    }
    
    const result = await pool.query(
      'INSERT INTO editions (year, name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [year, name, start_date, end_date]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Year already exists' });
    }
    logError(error, req, { operation: 'create_edition', formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Get all guests assigned to an edition
router.get('/:id/guests', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT g.*, g.first_name || ' ' || g.last_name as name, 
             ge.category, ge.invited_at, ge.confirmed_at, ge.id as assignment_id
      FROM guests g
      JOIN guest_editions ge ON g.id = ge.guest_id
      WHERE ge.edition_id = $1
      ORDER BY g.first_name, g.last_name
    `, [id]);
    
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_edition_guests', editionId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// Assign guest to edition
router.post('/:id/guests', async (req, res) => {
  try {
    const { id } = req.params;
    const { guest_id, category } = req.body;
    
    if (!guest_id || !category) {
      return res.status(400).json({ error: 'Guest ID and category are required' });
    }
    
    const validCategories = ['filmmaker', 'press', 'guest', 'staff'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    
    const result = await pool.query(
      'INSERT INTO guest_editions (guest_id, edition_id, category) VALUES ($1, $2, $3) RETURNING *',
      [guest_id, id, category]
    );
    
    // Get full guest info
    const guestResult = await pool.query(`
      SELECT g.*, g.first_name || ' ' || g.last_name as name,
             ge.category, ge.invited_at, ge.confirmed_at, ge.id as assignment_id
      FROM guests g
      JOIN guest_editions ge ON g.id = ge.guest_id
      WHERE ge.id = $1
    `, [result.rows[0].id]);
    
    res.status(201).json(guestResult.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Guest already assigned to this edition' });
    }
    logError(error, req, { operation: 'assign_guest_to_edition', editionId: req.params.id, formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Update guest assignment
router.put('/:id/guests/:assignmentId', async (req, res) => {
  try {
    const { id, assignmentId } = req.params;
    const { category } = req.body;
    
    const validCategories = ['filmmaker', 'press', 'guest', 'staff'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    
    const result = await pool.query(
      'UPDATE guest_editions SET category = $1 WHERE id = $2 AND edition_id = $3 RETURNING *',
      [category, assignmentId, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'update_guest_assignment', editionId: req.params.id, assignmentId: req.params.assignmentId, formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Remove guest from edition
router.delete('/:id/guests/:assignmentId', async (req, res) => {
  try {
    const { id, assignmentId } = req.params;
    
    const result = await pool.query(
      'DELETE FROM guest_editions WHERE id = $1 AND edition_id = $2 RETURNING *',
      [assignmentId, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    
    res.json({ message: 'Guest removed from edition successfully' });
  } catch (error) {
    logError(error, req, { operation: 'remove_guest_from_edition', editionId: req.params.id, assignmentId: req.params.assignmentId });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;