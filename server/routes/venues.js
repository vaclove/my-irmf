const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Get all venues
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM venues 
      WHERE active = true 
      ORDER BY sort_order, name_cs
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching venues:', error);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
});

// Get venue by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM venues WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching venue:', error);
    res.status(500).json({ error: 'Failed to fetch venue' });
  }
});

// Create new venue
router.post('/', async (req, res) => {
  try {
    const { name_cs, name_en, capacity, sort_order } = req.body;
    
    if (!name_cs || !name_en) {
      return res.status(400).json({ error: 'Name in both Czech and English is required' });
    }
    
    const result = await pool.query(`
      INSERT INTO venues (name_cs, name_en, capacity, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name_cs, name_en, capacity || null, sort_order || 0]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating venue:', error);
    res.status(500).json({ error: 'Failed to create venue' });
  }
});

// Update venue
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name_cs, name_en, capacity, sort_order, active } = req.body;
    
    if (!name_cs || !name_en) {
      return res.status(400).json({ error: 'Name in both Czech and English is required' });
    }
    
    const result = await pool.query(`
      UPDATE venues 
      SET name_cs = $1, name_en = $2, capacity = $3, sort_order = $4, active = $5
      WHERE id = $6
      RETURNING *
    `, [name_cs, name_en, capacity || null, sort_order || 0, active !== false, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating venue:', error);
    res.status(500).json({ error: 'Failed to update venue' });
  }
});

// Delete venue (soft delete by setting active = false)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if venue is used in programming
    const usageCheck = await pool.query(
      'SELECT COUNT(*) as count FROM programming_schedule WHERE venue_id = $1',
      [id]
    );
    
    if (parseInt(usageCheck.rows[0].count) > 0) {
      // Soft delete if venue is used
      await pool.query('UPDATE venues SET active = false WHERE id = $1', [id]);
      res.json({ message: 'Venue deactivated (was used in programming)' });
    } else {
      // Hard delete if venue is not used
      const result = await pool.query('DELETE FROM venues WHERE id = $1 RETURNING *', [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Venue not found' });
      }
      
      res.json({ message: 'Venue deleted successfully' });
    }
  } catch (error) {
    console.error('Error deleting venue:', error);
    res.status(500).json({ error: 'Failed to delete venue' });
  }
});

module.exports = router;