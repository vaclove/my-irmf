const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware, captureOriginalData } = require('../utils/auditLogger');
const router = express.Router();

// Apply audit middleware to all routes
// Note: captureOriginalData must come before auditMiddleware
router.use(captureOriginalData('tags'));
router.use(auditMiddleware('tags'));

// Special middleware for guest-tag assignments
router.use('/assign', captureOriginalData('guest_tags', 'guest_id'));
router.use('/assign/:guest_id/:tag_id', captureOriginalData('guest_tags', 'guest_id'));

// Get all tags
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, COUNT(gt.guest_id) as guest_count
      FROM tags t
      LEFT JOIN guest_tags gt ON t.id = gt.tag_id
      GROUP BY t.id
      ORDER BY t.name
    `);
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_all_tags' });
    res.status(500).json({ error: error.message });
  }
});

// Create new tag
router.post('/', async (req, res) => {
  try {
    const { name, color } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    
    const result = await pool.query(
      'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *',
      [name.trim(), color || '#3B82F6']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Tag name already exists' });
    }
    logError(error, req, { operation: 'create_tag', formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Check if tag can be deleted (for frontend validation)
router.get('/:id/deletion-status', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get tag details
    const tagResult = await pool.query('SELECT * FROM tags WHERE id = $1', [id]);
    
    if (tagResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    
    const tag = tagResult.rows[0];
    
    // Check if tag is a year tag
    const yearTagCheck = await pool.query(
      'SELECT e.id, e.year, e.name FROM editions e WHERE e.year::text = $1',
      [tag.name]
    );
    
    let canDelete = true;
    let restrictions = [];
    
    // If this is a year tag, check invitations
    if (yearTagCheck.rows.length > 0) {
      const invitationCheck = await pool.query(`
        SELECT COUNT(DISTINCT gi.guest_id) as invited_guests
        FROM guest_invitations gi
        JOIN guest_tags gt ON gi.guest_id = gt.guest_id
        WHERE gt.tag_id = $1 AND gi.invited_at IS NOT NULL
      `, [id]);
      
      if (parseInt(invitationCheck.rows[0].invited_guests) > 0) {
        canDelete = false;
        restrictions.push({
          type: 'YEAR_TAG_WITH_INVITATIONS',
          message: `This year tag is linked to edition "${yearTagCheck.rows[0].name}" and ${invitationCheck.rows[0].invited_guests} guest(s) have already been invited.`,
          invited_guests: parseInt(invitationCheck.rows[0].invited_guests),
          edition: yearTagCheck.rows[0]
        });
      }
    }
    
    // Check guest assignments
    const usageCheck = await pool.query(
      'SELECT COUNT(*) FROM guest_tags WHERE tag_id = $1',
      [id]
    );
    
    if (parseInt(usageCheck.rows[0].count) > 0) {
      canDelete = false;
      restrictions.push({
        type: 'TAG_ASSIGNED_TO_GUESTS',
        message: `Tag is assigned to ${usageCheck.rows[0].count} guest(s).`,
        assigned_guests: parseInt(usageCheck.rows[0].count)
      });
    }
    
    res.json({
      tag: tag,
      can_delete: canDelete,
      restrictions: restrictions,
      is_year_tag: yearTagCheck.rows.length > 0
    });
  } catch (error) {
    logError(error, req, { operation: 'check_tag_deletion_status', tagId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// Update tag
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    
    const result = await pool.query(
      'UPDATE tags SET name = $1, color = $2 WHERE id = $3 RETURNING *',
      [name.trim(), color || '#3B82F6', id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Tag name already exists' });
    }
    logError(error, req, { operation: 'update_tag', tagId: req.params.id, formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Delete tag
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get tag details first
    const tagResult = await pool.query('SELECT * FROM tags WHERE id = $1', [id]);
    
    if (tagResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    
    const tag = tagResult.rows[0];
    
    // Check if tag is a year tag (matches an edition year)
    const yearTagCheck = await pool.query(
      'SELECT e.id, e.year, e.name FROM editions e WHERE e.year::text = $1',
      [tag.name]
    );
    
    // If this is a year tag, check if any guests with this tag have been invited
    if (yearTagCheck.rows.length > 0) {
      const invitationCheck = await pool.query(`
        SELECT COUNT(DISTINCT gi.guest_id) as invited_guests
        FROM guest_invitations gi
        JOIN guest_tags gt ON gi.guest_id = gt.guest_id
        WHERE gt.tag_id = $1 AND gi.invited_at IS NOT NULL
      `, [id]);
      
      if (parseInt(invitationCheck.rows[0].invited_guests) > 0) {
        const edition = yearTagCheck.rows[0];
        return res.status(400).json({ 
          error: `Cannot delete year tag "${tag.name}" for edition "${edition.name}". ${invitationCheck.rows[0].invited_guests} guest(s) with this tag have already been invited. You must remove invitations before deleting this tag.`,
          type: 'YEAR_TAG_WITH_INVITATIONS',
          edition: edition,
          invited_guests: parseInt(invitationCheck.rows[0].invited_guests)
        });
      }
    }
    
    // Check if tag is assigned to any guests
    const usageCheck = await pool.query(
      'SELECT COUNT(*) FROM guest_tags WHERE tag_id = $1',
      [id]
    );
    
    if (parseInt(usageCheck.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: `Cannot delete tag "${tag.name}" that is assigned to ${usageCheck.rows[0].count} guest(s). Remove from all guests first.`,
        type: 'TAG_ASSIGNED_TO_GUESTS',
        assigned_guests: parseInt(usageCheck.rows[0].count)
      });
    }
    
    const result = await pool.query('DELETE FROM tags WHERE id = $1 RETURNING *', [id]);
    
    res.json({ 
      message: `Tag "${tag.name}" deleted successfully`,
      deleted_tag: result.rows[0]
    });
  } catch (error) {
    logError(error, req, { operation: 'delete_tag', tagId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// Assign tag to guest
router.post('/assign', async (req, res) => {
  try {
    const { guest_id, tag_id } = req.body;
    
    if (!guest_id || !tag_id) {
      return res.status(400).json({ error: 'Guest ID and Tag ID are required' });
    }
    
    // Check if assignment already exists
    const existingCheck = await pool.query(
      'SELECT id FROM guest_tags WHERE guest_id = $1 AND tag_id = $2',
      [guest_id, tag_id]
    );
    
    if (existingCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Tag already assigned to this guest' });
    }
    
    const result = await pool.query(
      'INSERT INTO guest_tags (guest_id, tag_id) VALUES ($1, $2) RETURNING *',
      [guest_id, tag_id]
    );
    
    // Get tag details for response
    const tagResult = await pool.query(
      'SELECT t.* FROM tags t WHERE t.id = $1',
      [tag_id]
    );
    
    res.status(201).json({
      assignment: result.rows[0],
      tag: tagResult.rows[0]
    });
  } catch (error) {
    logError(error, req, { operation: 'assign_tag_to_guest', formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Remove tag from guest
router.delete('/assign/:guest_id/:tag_id', async (req, res) => {
  try {
    const { guest_id, tag_id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM guest_tags WHERE guest_id = $1 AND tag_id = $2 RETURNING *',
      [guest_id, tag_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag assignment not found' });
    }
    
    res.json({ message: 'Tag removed from guest successfully' });
  } catch (error) {
    logError(error, req, { operation: 'remove_tag_from_guest', guestId: req.params.guest_id, tagId: req.params.tag_id });
    res.status(500).json({ error: error.message });
  }
});

// Get all tags for a specific guest
router.get('/guest/:guest_id', async (req, res) => {
  try {
    const { guest_id } = req.params;
    
    const result = await pool.query(`
      SELECT t.*
      FROM tags t
      JOIN guest_tags gt ON t.id = gt.tag_id
      WHERE gt.guest_id = $1
      ORDER BY t.name
    `, [guest_id]);
    
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_guest_tags', guestId: req.params.guest_id });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;