const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Default sections with colors that will be created for new editions
const DEFAULT_SECTIONS = [
  { key: 'feature', name_cs: 'Celovečerní filmy', name_en: 'Feature Films', color_code: '#1C4563', sort_order: 1 },
  { key: 'documentary', name_cs: 'Dokumentární filmy', name_en: 'Documentary Films', color_code: '#4C762C', sort_order: 2 },
  { key: 'short', name_cs: 'Krátké filmy', name_en: 'Short Films', color_code: '#ECB21E', sort_order: 3 },
  { key: 'retrospective', name_cs: 'Retrospektiva', name_en: 'Retrospective', color_code: '#51A9A6', sort_order: 4 },
  { key: 'special', name_cs: 'Speciální projekce', name_en: 'Special Screenings', color_code: '#DF342C', sort_order: 5 },
  { key: 'workshop', name_cs: 'Workshop', name_en: 'Workshop', color_code: '#929289', sort_order: 6 },
  { key: 'concert', name_cs: 'Koncert', name_en: 'Concert', color_code: '#929289', sort_order: 7 },
  { key: 'discussion', name_cs: 'Diskuze', name_en: 'Discussion', color_code: '#F3C09F', sort_order: 8 }
];

// Get all sections for an edition
router.get('/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT * FROM sections 
      WHERE edition_id = $1 AND active = true
      ORDER BY sort_order, name_cs
    `, [editionId]);
    
    // If no sections exist for this edition, create default ones
    if (result.rows.length === 0) {
      await createDefaultSections(editionId);
      
      // Fetch the newly created sections
      const newResult = await pool.query(`
        SELECT * FROM sections 
        WHERE edition_id = $1 AND active = true
        ORDER BY sort_order, name_cs
      `, [editionId]);
      
      return res.json(newResult.rows);
    }
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sections:', error);
    res.status(500).json({ error: 'Failed to fetch sections' });
  }
});

// Get section by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('SELECT * FROM sections WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching section:', error);
    res.status(500).json({ error: 'Failed to fetch section' });
  }
});

// Create new section
router.post('/', async (req, res) => {
  try {
    const { edition_id, key, name_cs, name_en, color_code, sort_order } = req.body;
    
    if (!edition_id || !key || !name_cs || !name_en || !color_code) {
      return res.status(400).json({ 
        error: 'Edition ID, key, Czech name, English name, and color code are required' 
      });
    }
    
    // Validate color code format
    if (!/^#[0-9A-Fa-f]{6}$/.test(color_code)) {
      return res.status(400).json({ 
        error: 'Color code must be in hex format (#RRGGBB)' 
      });
    }
    
    const result = await pool.query(`
      INSERT INTO sections (edition_id, key, name_cs, name_en, color_code, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [edition_id, key, name_cs, name_en, color_code, sort_order || 0]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ 
        error: 'A section with this key already exists for this edition' 
      });
    }
    console.error('Error creating section:', error);
    res.status(500).json({ error: 'Failed to create section' });
  }
});

// Update section
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { key, name_cs, name_en, color_code, sort_order, active } = req.body;
    
    if (!name_cs || !name_en || !color_code) {
      return res.status(400).json({ 
        error: 'Czech name, English name, and color code are required' 
      });
    }
    
    // Validate color code format
    if (!/^#[0-9A-Fa-f]{6}$/.test(color_code)) {
      return res.status(400).json({ 
        error: 'Color code must be in hex format (#RRGGBB)' 
      });
    }
    
    const result = await pool.query(`
      UPDATE sections 
      SET key = COALESCE($1, key),
          name_cs = $2,
          name_en = $3,
          color_code = $4,
          sort_order = COALESCE($5, sort_order),
          active = COALESCE($6, active)
      WHERE id = $7
      RETURNING *
    `, [key, name_cs, name_en, color_code, sort_order, active, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ 
        error: 'A section with this key already exists for this edition' 
      });
    }
    console.error('Error updating section:', error);
    res.status(500).json({ error: 'Failed to update section' });
  }
});

// Delete section (soft delete by setting active = false)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if section is used by any movies
    const usageCheck = await pool.query(
      'SELECT COUNT(*) as count FROM movies WHERE section = (SELECT key FROM sections WHERE id = $1)',
      [id]
    );
    
    if (parseInt(usageCheck.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete section that is used by movies. Consider deactivating instead.' 
      });
    }
    
    const result = await pool.query(
      'UPDATE sections SET active = false WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    res.json({ message: 'Section deactivated successfully' });
  } catch (error) {
    console.error('Error deleting section:', error);
    res.status(500).json({ error: 'Failed to delete section' });
  }
});

// Reorder sections
router.put('/edition/:editionId/reorder', async (req, res) => {
  try {
    const { editionId } = req.params;
    const { sections } = req.body; // Array of {id, sort_order}
    
    if (!Array.isArray(sections)) {
      return res.status(400).json({ error: 'Sections array is required' });
    }
    
    // Update sort orders in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const section of sections) {
        await client.query(
          'UPDATE sections SET sort_order = $1 WHERE id = $2 AND edition_id = $3',
          [section.sort_order, section.id, editionId]
        );
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
    // Return updated sections
    const result = await pool.query(`
      SELECT * FROM sections 
      WHERE edition_id = $1 AND active = true
      ORDER BY sort_order, name_cs
    `, [editionId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error reordering sections:', error);
    res.status(500).json({ error: 'Failed to reorder sections' });
  }
});

// Initialize default sections for an edition
router.post('/edition/:editionId/initialize', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    await createDefaultSections(editionId);
    
    const result = await pool.query(`
      SELECT * FROM sections 
      WHERE edition_id = $1 AND active = true
      ORDER BY sort_order, name_cs
    `, [editionId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error initializing sections:', error);
    res.status(500).json({ error: 'Failed to initialize sections' });
  }
});

// Helper function to create default sections for an edition
async function createDefaultSections(editionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const section of DEFAULT_SECTIONS) {
      await client.query(`
        INSERT INTO sections (edition_id, key, name_cs, name_en, color_code, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (edition_id, key) DO NOTHING
      `, [editionId, section.key, section.name_cs, section.name_en, section.color_code, section.sort_order]);
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = router;