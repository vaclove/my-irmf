const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware, captureOriginalData } = require('../utils/auditLogger');
const { generateGreeting, generateGreetingOptions, validateGreetingInputs } = require('../utils/greetingGenerator');
const guestImageStorage = require('../services/guestImageStorage');
const router = express.Router();

// Apply audit middleware to all routes
// Note: captureOriginalData must come before auditMiddleware
router.use(captureOriginalData('guests'));
router.use(auditMiddleware('guests'));

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
             ) as tags,
             COALESCE(
               (SELECT JSON_AGG(
                 JSON_BUILD_OBJECT(
                   'primary_guest_id', gr.primary_guest_id,
                   'primary_guest_name', pg.first_name || ' ' || pg.last_name,
                   'relationship_type', gr.relationship_type,
                   'edition_id', gr.edition_id,
                   'edition_year', e.year
                 )
               )
               FROM guest_relationships gr
               JOIN guests pg ON gr.primary_guest_id = pg.id
               JOIN editions e ON gr.edition_id = e.id
               WHERE gr.related_guest_id = g.id),
               '[]'::json
             ) as secondary_relationships
      FROM guests g
      LEFT JOIN guest_tags gt ON g.id = gt.guest_id
      LEFT JOIN tags t ON gt.tag_id = t.id
      GROUP BY g.id
      ORDER BY g.first_name, g.last_name
    `);
    
    // Transform the results to include S3 image URLs instead of base64 data
    const transformedRows = result.rows.map(guest => {
      const transformed = { ...guest };
      
      // Remove the base64 photo data from response
      delete transformed.photo;
      
      // Add S3 image URLs if the guest has migrated images
      if (guest.image_path) {
        transformed.image_urls = {
          thumbnail: guestImageStorage.getImageUrl(guest.image_path, 'thumbnail'),
          medium: guestImageStorage.getImageUrl(guest.image_path, 'medium'),
          original: guestImageStorage.getImageUrl(guest.image_path, 'original')
        };
      }
      
      return transformed;
    });
    
    res.json(transformedRows);
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
    
    // Transform the result to include S3 image URLs instead of base64 data
    const guest = { ...result.rows[0] };
    
    // Remove the base64 photo data from response
    delete guest.photo;
    
    // Add S3 image URLs if the guest has migrated images
    if (guest.image_path) {
      guest.image_urls = {
        thumbnail: guestImageStorage.getImageUrl(guest.image_path, 'thumbnail'),
        medium: guestImageStorage.getImageUrl(guest.image_path, 'medium'),
        original: guestImageStorage.getImageUrl(guest.image_path, 'original')
      };
    }
    
    res.json(guest);
  } catch (error) {
    logError(error, req, { operation: 'get_guest_by_id', guestId: id });
    res.status(500).json({ error: error.message });
  }
});

// Create new guest
router.post('/', async (req, res) => {
  try {
    const { first_name, last_name, email, phone, language, company, notes, greeting, photo } = req.body;
    
    if (!first_name || !last_name || !email) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }
    
    // Validate language if provided
    if (language && !['czech', 'english'].includes(language)) {
      return res.status(400).json({ error: 'Language must be either "czech" or "english"' });
    }
    
    const guestLanguage = language || 'english';
    
    // Generate greeting if not provided
    let finalGreeting = greeting;
    let greetingAutoGenerated = false;
    
    if (!finalGreeting && first_name && last_name) {
      const greetingResult = generateGreeting(first_name, last_name, guestLanguage);
      finalGreeting = greetingResult.greeting;
      greetingAutoGenerated = true;
    }
    
    // Handle photo upload to S3 if provided
    let imagePath = null;
    let imageMigrated = false;
    
    if (photo && photo.trim()) {
      try {
        // Insert guest first to get the ID
        const guestResult = await pool.query(
          `INSERT INTO guests (first_name, last_name, email, phone, language, company, notes, greeting, greeting_auto_generated, photo, image_path, image_migrated) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
           RETURNING *`,
          [first_name, last_name, email, phone, guestLanguage, company, notes, finalGreeting, greetingAutoGenerated, photo, null, false]
        );
        
        const newGuest = guestResult.rows[0];
        
        // Upload photo to S3
        const uploadResult = await guestImageStorage.migrateBase64Image(photo, newGuest.id);
        imagePath = uploadResult.basePath;
        imageMigrated = true;
        
        // Update guest with S3 path
        await pool.query(
          `UPDATE guests SET image_path = $1, image_migrated = $2 WHERE id = $3`,
          [imagePath, imageMigrated, newGuest.id]
        );
        
        newGuest.image_path = imagePath;
        newGuest.image_migrated = imageMigrated;
        
        // Transform response to include S3 URLs
        const responseGuest = { ...newGuest };
        delete responseGuest.photo; // Remove base64 data
        
        if (imagePath) {
          responseGuest.image_urls = {
            thumbnail: guestImageStorage.getImageUrl(imagePath, 'thumbnail'),
            medium: guestImageStorage.getImageUrl(imagePath, 'medium'),
            original: guestImageStorage.getImageUrl(imagePath, 'original')
          };
        }
        
        res.status(201).json(responseGuest);
        
      } catch (uploadError) {
        console.error('Failed to upload guest photo to S3:', uploadError);
        // If S3 upload fails, still create the guest with database photo as fallback
        const result = await pool.query(
          `INSERT INTO guests (first_name, last_name, email, phone, language, company, notes, greeting, greeting_auto_generated, photo) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
           RETURNING *`,
          [first_name, last_name, email, phone, guestLanguage, company, notes, finalGreeting, greetingAutoGenerated, photo]
        );
        
        const responseGuest = { ...result.rows[0] };
        delete responseGuest.photo;
        res.status(201).json(responseGuest);
      }
    } else {
      // No photo provided
      const result = await pool.query(
        `INSERT INTO guests (first_name, last_name, email, phone, language, company, notes, greeting, greeting_auto_generated, photo, image_path, image_migrated) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
         RETURNING *`,
        [first_name, last_name, email, phone, guestLanguage, company, notes, finalGreeting, greetingAutoGenerated, null, null, false]
      );
      
      const responseGuest = { ...result.rows[0] };
      delete responseGuest.photo;
      res.status(201).json(responseGuest);
    }
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
    const { first_name, last_name, email, phone, language, company, notes, greeting, photo } = req.body;
    
    // Validate language if provided
    if (language && !['czech', 'english'].includes(language)) {
      return res.status(400).json({ error: 'Language must be either "czech" or "english"' });
    }
    
    const guestLanguage = language || 'english';
    
    // Handle greeting update logic
    let finalGreeting = greeting;
    let greetingAutoGenerated = false;
    
    // If greeting is explicitly provided, use it (user manually entered)
    if (greeting !== undefined) {
      finalGreeting = greeting;
      greetingAutoGenerated = false;
    } else if (first_name && last_name) {
      // If no greeting provided but we have names, generate one
      const greetingResult = generateGreeting(first_name, last_name, guestLanguage);
      finalGreeting = greetingResult.greeting;
      greetingAutoGenerated = true;
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
       greeting = $8,
       greeting_auto_generated = $9,
       photo = $10,
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $11 
       RETURNING *`,
      [first_name, last_name, email, phone, guestLanguage, company, notes, finalGreeting, greetingAutoGenerated, photo, id]
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

// Generate greeting for given name and language (for real-time preview)
router.post('/generate-greeting', async (req, res) => {
  try {
    const { firstName, lastName, language } = req.body;
    
    // Validate inputs
    const validation = validateGreetingInputs(firstName, lastName, language);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Invalid input', 
        details: validation.errors 
      });
    }
    
    // Generate greeting options
    const greetingOptions = generateGreetingOptions(firstName, lastName, language);
    
    // Return primary greeting and alternatives
    res.json({
      primary: greetingOptions[0] || null,
      alternatives: greetingOptions.slice(1),
      validation: validation
    });
  } catch (error) {
    logError(error, req, { operation: 'generate_greeting', formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;