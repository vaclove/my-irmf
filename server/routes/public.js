const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const imageStorage = require('../services/imageStorage');
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

// Public movie catalog routes
// GET /api/public/movies - List movies with optional filtering
router.get('/public/movies', async (req, res) => {
  try {
    const { 
      edition_id, 
      section, 
      year, 
      country,
      limit = 100,
      offset = 0,
      sort = 'year_desc'
    } = req.query;

    let query = `
      SELECT 
        m.id,
        m.mysql_id,
        m.name_cs,
        m.name_en,
        m.synopsis_cs,
        m.synopsis_en,
        m.director,
        m.year,
        m.country,
        m.runtime,
        m.section,
        m.premiere,
        m.language,
        m.subtitles,
        m.is_35mm,
        m.has_delegation,
        m.image_data,
        m.image_url,
        e.year as edition_year,
        e.name as edition_name
      FROM movies m
      JOIN editions e ON m.edition_id = e.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;

    // Add filters
    if (edition_id) {
      params.push(edition_id);
      query += ` AND m.edition_id = $${++paramCount}`;
    }
    
    if (section) {
      params.push(section);
      query += ` AND m.section = $${++paramCount}`;
    }
    
    if (year) {
      params.push(year);
      query += ` AND m.year = $${++paramCount}`;
    }
    
    if (country) {
      params.push(`%${country.toUpperCase()}%`);
      query += ` AND UPPER(m.country) LIKE $${++paramCount}`;
    }

    // Add sorting
    switch (sort) {
      case 'name_asc':
        query += ' ORDER BY m.name_cs ASC';
        break;
      case 'name_desc':
        query += ' ORDER BY m.name_cs DESC';
        break;
      case 'year_asc':
        query += ' ORDER BY m.year ASC, m.name_cs ASC';
        break;
      case 'year_desc':
      default:
        query += ' ORDER BY m.year DESC, m.name_cs ASC';
        break;
    }

    // Add pagination
    params.push(limit);
    query += ` LIMIT $${++paramCount}`;
    params.push(offset);
    query += ` OFFSET $${++paramCount}`;

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM movies m
      WHERE 1=1
    `;
    
    if (edition_id) countQuery += ` AND m.edition_id = '${edition_id}'`;
    if (section) countQuery += ` AND m.section = '${section}'`;
    if (year) countQuery += ` AND m.year = ${year}`;
    if (country) countQuery += ` AND UPPER(m.country) LIKE '%${country.toUpperCase()}%'`;
    
    const countResult = await pool.query(countQuery);
    const total = parseInt(countResult.rows[0].total);

    // Add image URLs to movies
    const moviesWithImages = result.rows.map(movie => {
      if (movie.image_url) {
        movie.image_urls = {
          original: imageStorage.getImageUrl(movie.image_url, 'original'),
          large: imageStorage.getImageUrl(movie.image_url, 'large'),
          medium: imageStorage.getImageUrl(movie.image_url, 'medium'),
          thumbnail: imageStorage.getImageUrl(movie.image_url, 'thumbnail'),
          small: imageStorage.getImageUrl(movie.image_url, 'small')
        };
      }
      // Remove image_data from response to reduce payload size
      delete movie.image_data;
      return movie;
    });

    res.json({
      movies: moviesWithImages,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logError(error, req, { operation: 'list_public_movies' });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/public/movies/:id - Get specific movie details
router.get('/public/movies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Support both UUID and MySQL ID for backward compatibility
    const isUuid = id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    
    const query = `
      SELECT 
        m.*,
        e.year as edition_year,
        e.name as edition_name
      FROM movies m
      JOIN editions e ON m.edition_id = e.id
      WHERE ${isUuid ? 'm.id' : 'm.mysql_id'} = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    const movie = result.rows[0];
    
    // Add image URLs if image_url exists
    if (movie.image_url) {
      movie.image_urls = {
        original: imageStorage.getImageUrl(movie.image_url, 'original'),
        large: imageStorage.getImageUrl(movie.image_url, 'large'),
        medium: imageStorage.getImageUrl(movie.image_url, 'medium'),
        thumbnail: imageStorage.getImageUrl(movie.image_url, 'thumbnail'),
        small: imageStorage.getImageUrl(movie.image_url, 'small')
      };
    }
    
    // Remove image_data from response to reduce payload size
    delete movie.image_data;
    
    res.json({
      movie,
      // Include WordPress compatibility fields
      wordpress_url: `/movie/${movie.mysql_id || movie.id}/`
    });

  } catch (error) {
    logError(error, req, { operation: 'get_public_movie', movieId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/public/editions - List available editions
router.get('/public/editions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        e.id,
        e.year,
        e.name,
        e.start_date,
        e.end_date,
        COUNT(m.id) as movie_count
      FROM editions e
      LEFT JOIN movies m ON e.id = m.edition_id
      GROUP BY e.id, e.year, e.name, e.start_date, e.end_date
      ORDER BY e.year DESC
    `);
    
    res.json({
      editions: result.rows
    });

  } catch (error) {
    logError(error, req, { operation: 'list_public_editions' });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;