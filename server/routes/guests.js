const express = require('express');
const { pool } = require('../models/database');
const router = express.Router();

// Get all guests
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM guests ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get guest by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM guests WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Guest not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new guest
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, language, company, note } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    
    // Validate language if provided
    if (language && !['czech', 'english'].includes(language)) {
      return res.status(400).json({ error: 'Language must be either "czech" or "english"' });
    }
    
    const result = await pool.query(
      'INSERT INTO guests (name, email, phone, language, company, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, email, phone, language || 'english', company, note]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update guest
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, language, company, note } = req.body;
    
    // Validate language if provided
    if (language && !['czech', 'english'].includes(language)) {
      return res.status(400).json({ error: 'Language must be either "czech" or "english"' });
    }
    
    const result = await pool.query(
      'UPDATE guests SET name = $1, email = $2, phone = $3, language = $4, company = $5, note = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *',
      [name, email, phone, language, company, note, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Guest not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
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
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;