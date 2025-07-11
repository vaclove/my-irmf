const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware, captureOriginalData } = require('../utils/auditLogger');
const router = express.Router();

// Apply audit middleware to all routes
// Note: captureOriginalData must come before auditMiddleware
router.use(captureOriginalData('editions'));
router.use(auditMiddleware('editions'));

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

// Get all guests assigned to an edition (based on year tags)
router.get('/:id/guests', async (req, res) => {
  try {
    const { id } = req.params;
    
    // First get the edition to find its year
    const editionResult = await pool.query('SELECT year FROM editions WHERE id = $1', [id]);
    
    if (editionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Edition not found' });
    }
    
    const editionYear = editionResult.rows[0].year;
    
    // Get all guests who have the year tag for this edition
    const result = await pool.query(`
      SELECT DISTINCT ON (g.id) g.*, 
             g.first_name || ' ' || g.last_name as name,
             (SELECT COALESCE(
               JSON_AGG(
                 JSON_BUILD_OBJECT(
                   'id', t_sub.id,
                   'name', t_sub.name,
                   'color', t_sub.color
                 ) ORDER BY t_sub.name
               ),
               '[]'::json
             )
             FROM guest_tags gt_sub 
             JOIN tags t_sub ON gt_sub.tag_id = t_sub.id 
             WHERE gt_sub.guest_id = g.id
             ) as tags,
             -- Determine category from tags (prefer specific category tags, default to 'guest')
             COALESCE(
               (SELECT t2.name
                FROM guest_tags gt2 
                JOIN tags t2 ON gt2.tag_id = t2.id 
                WHERE gt2.guest_id = g.id 
                AND t2.name IN ('filmmaker', 'press', 'staff', 'guest')
                ORDER BY CASE t2.name 
                  WHEN 'filmmaker' THEN 1
                  WHEN 'press' THEN 2  
                  WHEN 'staff' THEN 3
                  WHEN 'guest' THEN 4
                  ELSE 5
                END
                LIMIT 1),
               'guest'
             ) as category,
             gi.invited_at,
             gi.confirmed_at,
             gi.id as assignment_id
      FROM guests g
      JOIN guest_tags gt ON g.id = gt.guest_id
      JOIN tags year_tag ON gt.tag_id = year_tag.id
      LEFT JOIN guest_invitations gi ON g.id = gi.guest_id AND gi.edition_id = $2
      WHERE year_tag.name = $1
      ORDER BY g.id, g.first_name, g.last_name
    `, [editionYear.toString(), id]);
    
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_edition_guests', editionId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// Assign guest to edition (deprecated - now done via tags)
// This endpoint is kept for backward compatibility but will return an error
router.post('/:id/guests', async (req, res) => {
  res.status(400).json({ 
    error: 'Manual guest assignment is deprecated. Please assign guests using year tags instead.',
    instructions: 'To assign a guest to an edition, add the year tag (e.g., "2025") to the guest.'
  });
});

// Update guest assignment (deprecated - now done via tags)
router.put('/:id/guests/:assignmentId', async (req, res) => {
  res.status(400).json({ 
    error: 'Manual guest assignment updates are deprecated. Please manage guest categories using tags instead.',
    instructions: 'To change a guest category, add/remove category tags (filmmaker, press, guest, staff) from the guest.'
  });
});

// Remove guest from edition (deprecated - now done via tags)
router.delete('/:id/guests/:assignmentId', async (req, res) => {
  res.status(400).json({ 
    error: 'Manual guest removal is deprecated. Please remove year tags instead.',
    instructions: 'To remove a guest from an edition, remove the year tag (e.g., "2025") from the guest.'
  });
});

// Manually confirm guest invitation (deprecated)
router.put('/:id/guests/:assignmentId/confirm', async (req, res) => {
  res.status(400).json({ 
    error: 'Manual invitation confirmation is deprecated with tag-based assignments.',
    instructions: 'Invitation management will be reimplemented with the new tag-based system.'
  });
});

module.exports = router;