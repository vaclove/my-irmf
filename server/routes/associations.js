const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Apply authentication to all routes
router.use(requireAuth);

// GUEST RELATIONSHIPS ROUTES

// GET /api/associations/relationships/:editionId - Get all guest relationships for an edition
router.get('/relationships/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        gr.id,
        gr.primary_guest_id,
        gr.related_guest_id,
        gr.relationship_type,
        gr.edition_id,
        gr.notes,
        gr.created_at,
        pg.first_name || ' ' || pg.last_name as primary_guest_name,
        pg.email as primary_guest_email,
        rg.first_name || ' ' || rg.last_name as related_guest_name,
        rg.email as related_guest_email
      FROM guest_relationships gr
      JOIN guests pg ON gr.primary_guest_id = pg.id
      JOIN guests rg ON gr.related_guest_id = rg.id
      WHERE gr.edition_id = $1
      ORDER BY pg.last_name, pg.first_name, gr.relationship_type
    `, [editionId]);
    
    res.json({ relationships: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_guest_relationships', editionId: req.params.editionId });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/associations/relationships/guest/:guestId/:editionId - Get relationships for a specific guest
router.get('/relationships/guest/:guestId/:editionId', async (req, res) => {
  try {
    const { guestId, editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        gr.id,
        gr.primary_guest_id,
        gr.related_guest_id,
        gr.relationship_type,
        gr.edition_id,
        gr.notes,
        gr.created_at,
        CASE 
          WHEN gr.primary_guest_id = $1 THEN rg.first_name || ' ' || rg.last_name
          ELSE pg.first_name || ' ' || pg.last_name
        END as other_guest_name,
        CASE 
          WHEN gr.primary_guest_id = $1 THEN rg.email
          ELSE pg.email
        END as other_guest_email,
        CASE 
          WHEN gr.primary_guest_id = $1 THEN gr.related_guest_id
          ELSE gr.primary_guest_id
        END as other_guest_id,
        CASE 
          WHEN gr.primary_guest_id = $1 THEN 'outgoing'
          ELSE 'incoming'
        END as relationship_direction
      FROM guest_relationships gr
      JOIN guests pg ON gr.primary_guest_id = pg.id
      JOIN guests rg ON gr.related_guest_id = rg.id
      WHERE (gr.primary_guest_id = $1 OR gr.related_guest_id = $1) 
        AND gr.edition_id = $2
      ORDER BY gr.relationship_type, other_guest_name
    `, [guestId, editionId]);
    
    res.json({ relationships: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_guest_relationships_by_guest', guestId: req.params.guestId });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/associations/relationships - Create guest relationship
router.post('/relationships', async (req, res) => {
  try {
    const { primary_guest_id, related_guest_id, relationship_type, edition_id, notes } = req.body;
    
    if (!primary_guest_id || !related_guest_id || !relationship_type || !edition_id) {
      return res.status(400).json({ error: 'Primary guest, related guest, relationship type, and edition are required' });
    }
    
    if (primary_guest_id === related_guest_id) {
      return res.status(400).json({ error: 'A guest cannot be related to themselves' });
    }
    
    const result = await pool.query(`
      INSERT INTO guest_relationships (primary_guest_id, related_guest_id, relationship_type, edition_id, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [primary_guest_id, related_guest_id, relationship_type, edition_id, notes]);
    
    // Get the full relationship data with guest names
    const fullResult = await pool.query(`
      SELECT 
        gr.id,
        gr.primary_guest_id,
        gr.related_guest_id,
        gr.relationship_type,
        gr.edition_id,
        gr.notes,
        gr.created_at,
        pg.first_name || ' ' || pg.last_name as primary_guest_name,
        pg.email as primary_guest_email,
        rg.first_name || ' ' || rg.last_name as related_guest_name,
        rg.email as related_guest_email
      FROM guest_relationships gr
      JOIN guests pg ON gr.primary_guest_id = pg.id
      JOIN guests rg ON gr.related_guest_id = rg.id
      WHERE gr.id = $1
    `, [result.rows[0].id]);
    
    res.status(201).json({ relationship: fullResult.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'This relationship already exists' });
    } else {
      logError(error, req, { operation: 'create_guest_relationship' });
      res.status(500).json({ error: error.message });
    }
  }
});

// DELETE /api/associations/relationships/:id - Delete guest relationship
router.delete('/relationships/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM guest_relationships WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Relationship not found' });
    }
    
    res.json({ message: 'Relationship deleted successfully' });
  } catch (error) {
    logError(error, req, { operation: 'delete_guest_relationship', relationshipId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// MOVIE DELEGATIONS ROUTES

// GET /api/associations/delegations/:editionId - Get all movie delegations for an edition
router.get('/delegations/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        md.id,
        md.guest_id,
        md.movie_id,
        md.role,
        md.is_primary,
        md.notes,
        md.created_at,
        g.first_name || ' ' || g.last_name as guest_name,
        g.email as guest_email,
        m.name_cs as movie_name_cs,
        m.name_en as movie_name_en,
        m.director,
        m.year,
        m.section
      FROM movie_delegations md
      JOIN guests g ON md.guest_id = g.id
      JOIN movies m ON md.movie_id = m.id
      WHERE m.edition_id = $1
      ORDER BY m.name_cs, m.name_en, md.is_primary DESC, g.last_name, g.first_name
    `, [editionId]);
    
    res.json({ delegations: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_movie_delegations', editionId: req.params.editionId });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/associations/delegations/guest/:guestId - Get delegations for a specific guest
router.get('/delegations/guest/:guestId', async (req, res) => {
  try {
    const { guestId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        md.id,
        md.guest_id,
        md.movie_id,
        md.role,
        md.is_primary,
        md.notes,
        md.created_at,
        m.name_cs as movie_name_cs,
        m.name_en as movie_name_en,
        m.director,
        m.year,
        m.section,
        e.year as edition_year,
        e.name as edition_name
      FROM movie_delegations md
      JOIN movies m ON md.movie_id = m.id
      JOIN editions e ON m.edition_id = e.id
      WHERE md.guest_id = $1
      ORDER BY e.year DESC, m.name_cs, m.name_en
    `, [guestId]);
    
    res.json({ delegations: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_delegations_by_guest', guestId: req.params.guestId });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/associations/delegations/movie/:movieId - Get delegations for a specific movie
router.get('/delegations/movie/:movieId', async (req, res) => {
  try {
    const { movieId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        md.id,
        md.guest_id,
        md.movie_id,
        md.role,
        md.is_primary,
        md.notes,
        md.created_at,
        g.first_name || ' ' || g.last_name as guest_name,
        g.email as guest_email,
        g.phone as guest_phone,
        g.company as guest_company
      FROM movie_delegations md
      JOIN guests g ON md.guest_id = g.id
      WHERE md.movie_id = $1
      ORDER BY md.is_primary DESC, md.role, g.last_name, g.first_name
    `, [movieId]);
    
    res.json({ delegations: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_delegations_by_movie', movieId: req.params.movieId });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/associations/delegations - Create movie delegation
router.post('/delegations', async (req, res) => {
  try {
    const { guest_id, movie_id, role, is_primary = false, notes } = req.body;
    
    if (!guest_id || !movie_id || !role) {
      return res.status(400).json({ error: 'Guest, movie, and role are required' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // If setting as primary, unset other primary delegations for this movie
      if (is_primary) {
        await client.query(
          'UPDATE movie_delegations SET is_primary = false WHERE movie_id = $1',
          [movie_id]
        );
      }
      
      const result = await client.query(`
        INSERT INTO movie_delegations (guest_id, movie_id, role, is_primary, notes)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [guest_id, movie_id, role, is_primary, notes]);
      
      await client.query('COMMIT');
      
      // Get the full delegation data with guest and movie names
      const fullResult = await pool.query(`
        SELECT 
          md.id,
          md.guest_id,
          md.movie_id,
          md.role,
          md.is_primary,
          md.notes,
          md.created_at,
          g.first_name || ' ' || g.last_name as guest_name,
          g.email as guest_email,
          m.name_cs as movie_name_cs,
          m.name_en as movie_name_en,
          m.director,
          m.year,
          m.section
        FROM movie_delegations md
        JOIN guests g ON md.guest_id = g.id
        JOIN movies m ON md.movie_id = m.id
        WHERE md.id = $1
      `, [result.rows[0].id]);
      
      res.status(201).json({ delegation: fullResult.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'This delegation already exists' });
    } else {
      logError(error, req, { operation: 'create_movie_delegation' });
      res.status(500).json({ error: error.message });
    }
  }
});

// PUT /api/associations/delegations/:id - Update movie delegation
router.put('/delegations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { role, is_primary, notes } = req.body;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get current delegation to check movie_id
      const currentResult = await client.query('SELECT movie_id FROM movie_delegations WHERE id = $1', [id]);
      if (currentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Delegation not found' });
      }
      
      const movieId = currentResult.rows[0].movie_id;
      
      // If setting as primary, unset other primary delegations for this movie
      if (is_primary) {
        await client.query(
          'UPDATE movie_delegations SET is_primary = false WHERE movie_id = $1 AND id != $2',
          [movieId, id]
        );
      }
      
      const result = await client.query(`
        UPDATE movie_delegations 
        SET role = COALESCE($2, role),
            is_primary = COALESCE($3, is_primary),
            notes = COALESCE($4, notes)
        WHERE id = $1
        RETURNING *
      `, [id, role, is_primary, notes]);
      
      await client.query('COMMIT');
      
      // Get the full delegation data
      const fullResult = await pool.query(`
        SELECT 
          md.id,
          md.guest_id,
          md.movie_id,
          md.role,
          md.is_primary,
          md.notes,
          md.created_at,
          g.first_name || ' ' || g.last_name as guest_name,
          g.email as guest_email,
          m.name_cs as movie_name_cs,
          m.name_en as movie_name_en,
          m.director,
          m.year,
          m.section
        FROM movie_delegations md
        JOIN guests g ON md.guest_id = g.id
        JOIN movies m ON md.movie_id = m.id
        WHERE md.id = $1
      `, [id]);
      
      res.json({ delegation: fullResult.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logError(error, req, { operation: 'update_movie_delegation', delegationId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/associations/delegations/:id - Delete movie delegation
router.delete('/delegations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM movie_delegations WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Delegation not found' });
    }
    
    res.json({ message: 'Delegation deleted successfully' });
  } catch (error) {
    logError(error, req, { operation: 'delete_movie_delegation', delegationId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;