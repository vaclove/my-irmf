const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware, captureOriginalData } = require('../utils/auditLogger');
const imageStorage = require('../services/imageStorage');
const googleDrive = require('../services/googleDrive');
const router = express.Router();

// Apply audit middleware to all routes
router.use(captureOriginalData('movies'));
router.use(auditMiddleware('movies'));

// Get all movies with optional edition filter
router.get('/', async (req, res) => {
  try {
    const { edition_id } = req.query;
    
    let query = `
      SELECT m.*, e.year as edition_year, e.name as edition_name,
             COALESCE(mf.has_movie_file, false) AS has_movie_file,
             COALESCE(mf.has_movie_proxy, false) AS has_movie_proxy,
             COALESCE(mf.has_subtitles_cs, false) AS has_subtitles_cs,
             COALESCE(mf.has_subtitles_en, false) AS has_subtitles_en
      FROM movies m
      JOIN editions e ON m.edition_id = e.id
      LEFT JOIN (
        SELECT movie_id,
               BOOL_OR(file_kind = 'movie') AS has_movie_file,
               BOOL_OR(file_kind = 'movie_proxy') AS has_movie_proxy,
               BOOL_OR(file_kind = 'subtitles_cs') AS has_subtitles_cs,
               BOOL_OR(file_kind = 'subtitles_en') AS has_subtitles_en
        FROM movie_files GROUP BY movie_id
      ) mf ON mf.movie_id = m.id
    `;
    let params = [];

    if (edition_id) {
      query += ' WHERE m.edition_id = $1';
      params.push(edition_id);
    }
    
    query += ' ORDER BY m.year DESC, m.name_cs ASC';
    
    const result = await pool.query(query, params);
    
    // Add image URLs to each movie
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
      return movie;
    });
    
    res.json(moviesWithImages);
  } catch (error) {
    logError(error, req, { operation: 'get_all_movies' });
    res.status(500).json({ error: error.message });
  }
});

// Get movies by edition ID
router.get('/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const query = `
      SELECT m.*, e.year as edition_year, e.name as edition_name,
             COALESCE(mf.has_movie_file, false) AS has_movie_file,
             COALESCE(mf.has_movie_proxy, false) AS has_movie_proxy,
             COALESCE(mf.has_subtitles_cs, false) AS has_subtitles_cs,
             COALESCE(mf.has_subtitles_en, false) AS has_subtitles_en
      FROM movies m
      JOIN editions e ON m.edition_id = e.id
      LEFT JOIN (
        SELECT movie_id,
               BOOL_OR(file_kind = 'movie') AS has_movie_file,
               BOOL_OR(file_kind = 'movie_proxy') AS has_movie_proxy,
               BOOL_OR(file_kind = 'subtitles_cs') AS has_subtitles_cs,
               BOOL_OR(file_kind = 'subtitles_en') AS has_subtitles_en
        FROM movie_files GROUP BY movie_id
      ) mf ON mf.movie_id = m.id
      WHERE m.edition_id = $1
      ORDER BY m.year DESC, m.name_cs ASC
    `;
    
    const result = await pool.query(query, [editionId]);
    
    // Add image URLs to each movie
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
      return movie;
    });
    
    res.json(moviesWithImages);
  } catch (error) {
    logError(error, req, { operation: 'get_movies_by_edition' });
    res.status(500).json({ error: error.message });
  }
});

// Get movie by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT m.*, e.year as edition_year, e.name as edition_name,
             COALESCE(mf.has_movie_file, false) AS has_movie_file,
             COALESCE(mf.has_movie_proxy, false) AS has_movie_proxy,
             COALESCE(mf.has_subtitles_cs, false) AS has_subtitles_cs,
             COALESCE(mf.has_subtitles_en, false) AS has_subtitles_en
      FROM movies m
      JOIN editions e ON m.edition_id = e.id
      LEFT JOIN (
        SELECT movie_id,
               BOOL_OR(file_kind = 'movie') AS has_movie_file,
               BOOL_OR(file_kind = 'movie_proxy') AS has_movie_proxy,
               BOOL_OR(file_kind = 'subtitles_cs') AS has_subtitles_cs,
               BOOL_OR(file_kind = 'subtitles_en') AS has_subtitles_en
        FROM movie_files GROUP BY movie_id
      ) mf ON mf.movie_id = m.id
      WHERE m.id = $1
    `, [id]);
    
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
    
    res.json(movie);
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
      image_base64,
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
      has_delegation,
      is_public = true // Default to public if not specified
    } = req.body;
    
    if (!edition_id || !name_cs || !name_en) {
      return res.status(400).json({ error: 'Edition ID, Czech name, and English name are required' });
    }
    
    // Verify edition exists
    const editionCheck = await pool.query('SELECT id FROM editions WHERE id = $1', [edition_id]);
    if (editionCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Edition not found' });
    }
    
    // First create the movie without image
    const result = await pool.query(`
      INSERT INTO movies (
        edition_id, catalogue_year, name_cs, name_en, synopsis_cs, synopsis_en,
        image, runtime, director, year, country, "cast",
        premiere, section, language, subtitles, is_35mm, has_delegation, is_public
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      edition_id, catalogue_year, name_cs, name_en, synopsis_cs, synopsis_en,
      image, runtime, director, year, country, cast,
      premiere, section, language, subtitles, is_35mm || false, has_delegation || false, is_public
    ]);
    
    const movie = result.rows[0];
    
    // Handle image upload to blob storage if provided
    if (image_base64) {
      try {
        // Get edition year for folder structure
        const editionResult = await pool.query('SELECT year FROM editions WHERE id = $1', [edition_id]);
        const editionYear = editionResult.rows[0].year;
        
        // Upload image to blob storage
        const uploadResult = await imageStorage.migrateBase64Image(image_base64, editionYear, movie.id);
        
        // Update movie with image URL
        await pool.query(
          'UPDATE movies SET image_url = $2 WHERE id = $1',
          [movie.id, uploadResult.basePath]
        );
        
        movie.image_url = uploadResult.basePath;
      } catch (uploadError) {
        logError(uploadError, req, { operation: 'upload_movie_image' });
        console.error('Image upload failed:', uploadError.message);
        // Continue without image - don't fail the whole operation
      }
    }

    // Auto-create the movie's (empty) Drive folder. Best-effort: a Drive
    // failure must never block movie creation — the folder can be created
    // later on demand.
    if (googleDrive.isConfigured()) {
      try {
        const editionResult = await pool.query('SELECT year FROM editions WHERE id = $1', [edition_id]);
        const folderId = await googleDrive.ensureMovieFolder({
          id: movie.id,
          name_cs: movie.name_cs,
          name_en: movie.name_en,
          edition_year: editionResult.rows[0]?.year,
        });
        movie.drive_folder_id = folderId;
      } catch (folderError) {
        logError(folderError, req, { operation: 'auto_create_movie_folder', movieId: movie.id });
        console.error('Drive folder creation failed:', folderError.message);
        // Continue - folder can be created later from the detail page.
      }
    }

    res.status(201).json(movie);
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
      image_base64,
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
      has_delegation,
      is_public
    } = req.body;
    
    if (!name_cs || !name_en) {
      return res.status(400).json({ error: 'Czech name and English name are required' });
    }
    
    // Verify edition exists if provided
    if (edition_id) {
      const editionCheck = await pool.query('SELECT id FROM editions WHERE id = $1', [edition_id]);
      if (editionCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Edition not found' });
      }
    }
    
    // First update the movie data
    const result = await pool.query(`
      UPDATE movies SET 
        edition_id = COALESCE($2, edition_id),
        catalogue_year = $3,
        name_cs = $4,
        name_en = $5,
        synopsis_cs = $6,
        synopsis_en = $7,
        image = $8,
        runtime = $9,
        director = $10,
        year = $11,
        country = $12,
        "cast" = $13,
        premiere = $14,
        section = $15,
        language = $16,
        subtitles = $17,
        is_35mm = $18,
        has_delegation = $19,
        is_public = $20,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [
      id, edition_id, catalogue_year, name_cs, name_en, synopsis_cs, synopsis_en,
      image, runtime, director, year, country, cast,
      premiere, section, language, subtitles, is_35mm || false, has_delegation || false, is_public
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    const movie = result.rows[0];
    
    // Handle image upload to blob storage if provided
    if (image_base64) {
      try {
        // Get edition year for folder structure
        const editionResult = await pool.query('SELECT e.year FROM movies m JOIN editions e ON m.edition_id = e.id WHERE m.id = $1', [id]);
        const editionYear = editionResult.rows[0].year;
        
        // Upload image to blob storage
        const uploadResult = await imageStorage.migrateBase64Image(image_base64, editionYear, id);
        
        // Update movie with image URL
        await pool.query(
          'UPDATE movies SET image_url = $2 WHERE id = $1',
          [id, uploadResult.basePath]
        );
        
        movie.image_url = uploadResult.basePath;
      } catch (uploadError) {
        logError(uploadError, req, { operation: 'upload_movie_image' });
        console.error('Image upload failed:', uploadError.message);
        // Continue without image update - don't fail the whole operation
      }
    }
    
    res.json(movie);
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
      SELECT m.*, e.year as edition_year, e.name as edition_name,
             COALESCE(mf.has_movie_file, false) AS has_movie_file,
             COALESCE(mf.has_movie_proxy, false) AS has_movie_proxy,
             COALESCE(mf.has_subtitles_cs, false) AS has_subtitles_cs,
             COALESCE(mf.has_subtitles_en, false) AS has_subtitles_en
      FROM movies m
      JOIN editions e ON m.edition_id = e.id
      LEFT JOIN (
        SELECT movie_id,
               BOOL_OR(file_kind = 'movie') AS has_movie_file,
               BOOL_OR(file_kind = 'movie_proxy') AS has_movie_proxy,
               BOOL_OR(file_kind = 'subtitles_cs') AS has_subtitles_cs,
               BOOL_OR(file_kind = 'subtitles_en') AS has_subtitles_en
        FROM movie_files GROUP BY movie_id
      ) mf ON mf.movie_id = m.id
      WHERE m.section = $1
    `;
    let params = [section];
    
    if (edition_id) {
      query += ' AND m.edition_id = $2';
      params.push(edition_id);
    }
    
    query += ' ORDER BY m.year DESC, m.name_cs ASC';
    
    const result = await pool.query(query, params);
    
    // Add image URLs to each movie
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
      return movie;
    });
    
    res.json(moviesWithImages);
  } catch (error) {
    logError(error, req, { operation: 'get_movies_by_section', section: req.params.section });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;