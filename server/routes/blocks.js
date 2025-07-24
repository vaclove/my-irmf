const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Get all blocks for an edition
router.get('/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        mb.*,
        COUNT(bm.movie_id) as movie_count,
        COALESCE(calculate_block_runtime(mb.id), 0) as total_runtime
      FROM movie_blocks mb
      LEFT JOIN block_movies bm ON mb.id = bm.block_id
      WHERE mb.edition_id = $1
      GROUP BY mb.id
      ORDER BY mb.name_cs
    `, [editionId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching blocks:', error);
    res.status(500).json({ error: 'Failed to fetch blocks' });
  }
});

// Get block by ID with movies
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get block details
    const blockResult = await pool.query('SELECT * FROM movie_blocks WHERE id = $1', [id]);
    
    if (blockResult.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }
    
    // Get movies in the block
    const moviesResult = await pool.query(`
      SELECT 
        m.*,
        bm.sort_order
      FROM block_movies bm
      JOIN movies m ON bm.movie_id = m.id
      WHERE bm.block_id = $1
      ORDER BY bm.sort_order, m.name_cs
    `, [id]);
    
    const block = blockResult.rows[0];
    block.movies = moviesResult.rows;
    block.total_runtime = await calculateBlockRuntime(id);
    
    res.json(block);
  } catch (error) {
    console.error('Error fetching block:', error);
    res.status(500).json({ error: 'Failed to fetch block' });
  }
});

// Create new block
router.post('/', async (req, res) => {
  try {
    const { edition_id, name_cs, name_en, description_cs, description_en } = req.body;
    
    if (!edition_id || !name_cs) {
      return res.status(400).json({ error: 'Edition ID and Czech name are required' });
    }
    
    const result = await pool.query(`
      INSERT INTO movie_blocks (edition_id, name_cs, name_en, description_cs, description_en)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [edition_id, name_cs, name_en || '', description_cs || '', description_en || '']);
    
    const block = result.rows[0];
    block.movies = [];
    block.total_runtime = 0;
    
    res.status(201).json(block);
  } catch (error) {
    console.error('Error creating block:', error);
    res.status(500).json({ error: 'Failed to create block' });
  }
});

// Update block
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name_cs, name_en, description_cs, description_en } = req.body;
    
    if (!name_cs) {
      return res.status(400).json({ error: 'Czech name is required' });
    }
    
    const result = await pool.query(`
      UPDATE movie_blocks 
      SET name_cs = $1, name_en = $2, description_cs = $3, description_en = $4
      WHERE id = $5
      RETURNING *
    `, [name_cs, name_en || '', description_cs || '', description_en || '', id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating block:', error);
    res.status(500).json({ error: 'Failed to update block' });
  }
});

// Add movie to block
router.post('/:id/movies', async (req, res) => {
  try {
    const { id } = req.params;
    const { movie_id, sort_order } = req.body;
    
    if (!movie_id) {
      return res.status(400).json({ error: 'Movie ID is required' });
    }
    
    // Check if movie is already in the block
    const existingResult = await pool.query(
      'SELECT id FROM block_movies WHERE block_id = $1 AND movie_id = $2',
      [id, movie_id]
    );
    
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'Movie is already in this block' });
    }
    
    // Add movie to block
    await pool.query(`
      INSERT INTO block_movies (block_id, movie_id, sort_order)
      VALUES ($1, $2, $3)
    `, [id, movie_id, sort_order || 0]);
    
    // Return updated block with movies
    const blockWithMovies = await getBlockWithMovies(id);
    res.json(blockWithMovies);
  } catch (error) {
    console.error('Error adding movie to block:', error);
    res.status(500).json({ error: 'Failed to add movie to block' });
  }
});

// Remove movie from block
router.delete('/:id/movies/:movieId', async (req, res) => {
  try {
    const { id, movieId } = req.params;
    
    const result = await pool.query(
      'DELETE FROM block_movies WHERE block_id = $1 AND movie_id = $2 RETURNING *',
      [id, movieId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Movie not found in block' });
    }
    
    // Return updated block with movies
    const blockWithMovies = await getBlockWithMovies(id);
    res.json(blockWithMovies);
  } catch (error) {
    console.error('Error removing movie from block:', error);
    res.status(500).json({ error: 'Failed to remove movie from block' });
  }
});

// Update movie order in block
router.put('/:id/movies/order', async (req, res) => {
  try {
    const { id } = req.params;
    const { movies } = req.body; // Array of {movie_id, sort_order}
    
    if (!Array.isArray(movies)) {
      return res.status(400).json({ error: 'Movies array is required' });
    }
    
    // Update sort orders in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const movie of movies) {
        await client.query(
          'UPDATE block_movies SET sort_order = $1 WHERE block_id = $2 AND movie_id = $3',
          [movie.sort_order, id, movie.movie_id]
        );
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
    // Return updated block with movies
    const blockWithMovies = await getBlockWithMovies(id);
    res.json(blockWithMovies);
  } catch (error) {
    console.error('Error updating movie order:', error);
    res.status(500).json({ error: 'Failed to update movie order' });
  }
});

// Delete block
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if block is used in programming
    const usageCheck = await pool.query(
      'SELECT COUNT(*) as count FROM programming_schedule WHERE block_id = $1',
      [id]
    );
    
    if (parseInt(usageCheck.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete block that is scheduled in programming' 
      });
    }
    
    const result = await pool.query('DELETE FROM movie_blocks WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }
    
    res.json({ message: 'Block deleted successfully' });
  } catch (error) {
    console.error('Error deleting block:', error);
    res.status(500).json({ error: 'Failed to delete block' });
  }
});

// Helper function to get block with movies
async function getBlockWithMovies(blockId) {
  const blockResult = await pool.query('SELECT * FROM movie_blocks WHERE id = $1', [blockId]);
  
  if (blockResult.rows.length === 0) {
    throw new Error('Block not found');
  }
  
  const moviesResult = await pool.query(`
    SELECT 
      m.*,
      bm.sort_order
    FROM block_movies bm
    JOIN movies m ON bm.movie_id = m.id
    WHERE bm.block_id = $1
    ORDER BY bm.sort_order, m.name_cs
  `, [blockId]);
  
  const block = blockResult.rows[0];
  block.movies = moviesResult.rows;
  block.total_runtime = await calculateBlockRuntime(blockId);
  
  return block;
}

// Helper function to calculate block runtime
async function calculateBlockRuntime(blockId) {
  try {
    const result = await pool.query('SELECT calculate_block_runtime($1) as runtime', [blockId]);
    return result.rows[0].runtime || 0;
  } catch (error) {
    console.error('Error calculating block runtime:', error);
    return 0;
  }
}

module.exports = router;