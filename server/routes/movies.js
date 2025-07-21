const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware, captureOriginalData } = require('../utils/auditLogger');
const router = express.Router();

// Apply audit middleware to all routes
router.use(captureOriginalData('movies'));
router.use(auditMiddleware('movies'));

// Get all movies with optional edition filter
router.get('/', async (req, res) => {
  try {
    const { edition_id } = req.query;
    
    let query = `
      SELECT m.*, e.year as edition_year, e.name as edition_name 
      FROM movies m 
      JOIN editions e ON m.edition_id = e.id
    `;
    let params = [];
    
    if (edition_id) {
      query += ' WHERE m.edition_id = $1';
      params.push(edition_id);
    }
    
    query += ' ORDER BY m.year DESC, m.name_cs ASC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_all_movies' });
    res.status(500).json({ error: error.message });
  }
});

// Get movie by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT m.*, e.year as edition_year, e.name as edition_name 
      FROM movies m 
      JOIN editions e ON m.edition_id = e.id 
      WHERE m.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'get_movie_by_id', movieId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// Create new movie
router.post('/', async (req, res) => {
  try {
    const {
      edition_id,
      catalogue_year,
      name_cs,
      name_en,
      synopsis_cs,
      synopsis_en,
      image,
      image_data,
      runtime,
      director,
      year,
      country,
      cast,
      premiere,
      section,
      language,
      subtitles,
      is_35mm,
      has_delegation
    } = req.body;
    
    if (!edition_id || !name_cs) {
      return res.status(400).json({ error: 'Edition ID and Czech name are required' });
    }
    
    // Verify edition exists
    const editionCheck = await pool.query('SELECT id FROM editions WHERE id = $1', [edition_id]);
    if (editionCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Edition not found' });
    }
    
    const result = await pool.query(`
      INSERT INTO movies (
        edition_id, catalogue_year, name_cs, name_en, synopsis_cs, synopsis_en,
        image, image_data, runtime, director, year, country, "cast",
        premiere, section, language, subtitles, is_35mm, has_delegation
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      edition_id, catalogue_year, name_cs, name_en, synopsis_cs, synopsis_en,
      image, image_data, runtime, director, year, country, cast,
      premiere, section, language, subtitles, is_35mm || false, has_delegation || false
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'create_movie', body: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Update movie
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      edition_id,
      catalogue_year,
      name_cs,
      name_en,
      synopsis_cs,
      synopsis_en,
      image,
      image_data,
      runtime,
      director,
      year,
      country,
      cast,
      premiere,
      section,
      language,
      subtitles,
      is_35mm,
      has_delegation
    } = req.body;
    
    if (!name_cs) {
      return res.status(400).json({ error: 'Czech name is required' });
    }
    
    // Verify edition exists if provided
    if (edition_id) {
      const editionCheck = await pool.query('SELECT id FROM editions WHERE id = $1', [edition_id]);
      if (editionCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Edition not found' });
      }
    }
    
    const result = await pool.query(`
      UPDATE movies SET 
        edition_id = COALESCE($2, edition_id),
        catalogue_year = $3,
        name_cs = $4,
        name_en = $5,
        synopsis_cs = $6,
        synopsis_en = $7,
        image = $8,
        image_data = $9,
        runtime = $10,
        director = $11,
        year = $12,
        country = $13,
        "cast" = $14,
        premiere = $15,
        section = $16,
        language = $17,
        subtitles = $18,
        is_35mm = $19,
        has_delegation = $20,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [
      id, edition_id, catalogue_year, name_cs, name_en, synopsis_cs, synopsis_en,
      image, image_data, runtime, director, year, country, cast,
      premiere, section, language, subtitles, is_35mm || false, has_delegation || false
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'update_movie', movieId: req.params.id, body: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Delete movie
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM movies WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    res.json({ message: 'Movie deleted successfully', movie: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'delete_movie', movieId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// Get movies by section
router.get('/section/:section', async (req, res) => {
  try {
    const { section } = req.params;
    const { edition_id } = req.query;
    
    let query = `
      SELECT m.*, e.year as edition_year, e.name as edition_name 
      FROM movies m 
      JOIN editions e ON m.edition_id = e.id 
      WHERE m.section = $1
    `;
    let params = [section];
    
    if (edition_id) {
      query += ' AND m.edition_id = $2';
      params.push(edition_id);
    }
    
    query += ' ORDER BY m.year DESC, m.name_cs ASC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_movies_by_section', section: req.params.section });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;