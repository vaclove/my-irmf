const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Helper function to check for time overlaps
const checkTimeOverlap = async (venue_id, scheduled_date, scheduled_time, movie_id, block_id, discussion_time, excludeId = null) => {
  try {
    // Get the runtime of the current entry
    let currentRuntime = 0;
    if (movie_id) {
      const movieResult = await pool.query('SELECT runtime FROM movies WHERE id = $1', [movie_id]);
      if (movieResult.rows.length > 0) {
        currentRuntime = parseInt(movieResult.rows[0].runtime) || 0;
      }
    } else if (block_id) {
      const blockResult = await pool.query('SELECT calculate_block_runtime($1) as runtime', [block_id]);
      if (blockResult.rows.length > 0) {
        currentRuntime = parseInt(blockResult.rows[0].runtime) || 0;
      }
    }
    
    const totalCurrentRuntime = currentRuntime + parseInt(discussion_time || 0);
    
    // Calculate end time for current entry
    const [year, month, day] = scheduled_date.split('-').map(Number);
    const [hours, minutes] = scheduled_time.split(':').map(Number);
    
    const currentStart = new Date(Date.UTC(year, month - 1, day, hours, minutes));
    const currentEnd = new Date(currentStart.getTime() + totalCurrentRuntime * 60000); // Convert minutes to milliseconds
    
    // Find all existing entries for the same venue and date
    let conflictQuery = `
      SELECT 
        ps.id,
        ps.scheduled_time,
        ps.discussion_time,
        ps.movie_id,
        ps.block_id,
        m.runtime as movie_runtime
      FROM programming_schedule ps
      LEFT JOIN movies m ON ps.movie_id = m.id
      WHERE ps.venue_id = $1 AND ps.scheduled_date = $2
    `;
    
    const queryParams = [venue_id, scheduled_date];
    
    if (excludeId) {
      conflictQuery += ' AND ps.id != $3';
      queryParams.push(excludeId);
    }
    
    const existingEntries = await pool.query(conflictQuery, queryParams);
    
    // Check each existing entry for overlap
    for (const entry of existingEntries.rows) {
      const [existingHours, existingMinutes] = entry.scheduled_time.split(':').map(Number);
      const existingStart = new Date(Date.UTC(year, month - 1, day, existingHours, existingMinutes));
      
      // Calculate runtime for existing entry
      let existingRuntime = 0;
      if (entry.movie_id) {
        existingRuntime = parseInt(entry.movie_runtime) || 0;
      } else if (entry.block_id) {
        // Calculate block runtime using the database function
        const blockRuntimeResult = await pool.query('SELECT calculate_block_runtime($1) as runtime', [entry.block_id]);
        existingRuntime = parseInt(blockRuntimeResult.rows[0]?.runtime) || 0;
      }
      
      const existingTotalRuntime = existingRuntime + parseInt(entry.discussion_time || 0);
      const existingEnd = new Date(existingStart.getTime() + existingTotalRuntime * 60000);
      
      // Check if times overlap
      if (currentStart < existingEnd && currentEnd > existingStart) {
        const formatTime = (date) => {
          // Use UTC methods to avoid timezone conversion issues
          const hours = date.getUTCHours().toString().padStart(2, '0');
          const minutes = date.getUTCMinutes().toString().padStart(2, '0');
          return `${hours}:${minutes}`;
        };
        
        return {
          hasOverlap: true,
          conflictDetails: {
            existingStart: formatTime(existingStart),
            existingEnd: formatTime(existingEnd),
            newStart: formatTime(currentStart),
            newEnd: formatTime(currentEnd)
          }
        };
      }
    }
    
    return { hasOverlap: false };
  } catch (error) {
    console.error('Error checking time overlap:', error);
    throw error;
  }
};

// Check for time overlaps without creating an entry
router.post('/check-overlap', async (req, res) => {
  try {
    const {
      venue_id,
      scheduled_date,
      scheduled_time,
      movie_id,
      block_id,
      discussion_time,
      exclude_id
    } = req.body;
    
    if (!venue_id || !scheduled_date || !scheduled_time) {
      return res.status(400).json({ 
        error: 'Venue ID, date, and time are required' 
      });
    }
    
    if ((!movie_id && !block_id) || (movie_id && block_id)) {
      return res.status(400).json({ 
        error: 'Either movie ID or block ID must be provided, but not both' 
      });
    }
    
    const overlapCheck = await checkTimeOverlap(
      venue_id, scheduled_date, scheduled_time, 
      movie_id, block_id, discussion_time, exclude_id
    );
    
    res.json(overlapCheck);
  } catch (error) {
    console.error('Error checking overlap:', error);
    res.status(500).json({ error: 'Failed to check for overlaps' });
  }
});

// Get programming schedule for an edition
router.get('/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    const { date, venue_id } = req.query;
    
    let query = `
      SELECT 
        ps.*,
        v.name_cs as venue_name_cs,
        v.name_en as venue_name_en,
        v.capacity as venue_capacity,
        -- Movie details (if single movie)
        m.name_cs as movie_name_cs,
        m.name_en as movie_name_en,
        m.director as movie_director,
        m.runtime as movie_runtime,
        m.section as movie_section,
        -- Block details (if block)
        mb.name_cs as block_name_cs,
        mb.name_en as block_name_en,
        mb.description_cs as block_description_cs,
        mb.description_en as block_description_en
      FROM programming_schedule ps
      JOIN venues v ON ps.venue_id = v.id
      LEFT JOIN movies m ON ps.movie_id = m.id
      LEFT JOIN movie_blocks mb ON ps.block_id = mb.id
      WHERE ps.edition_id = $1
    `;
    
    const params = [editionId];
    let paramIndex = 2;
    
    if (date) {
      query += ` AND ps.scheduled_date = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    }
    
    if (venue_id) {
      query += ` AND ps.venue_id = $${paramIndex}`;
      params.push(venue_id);
      paramIndex++;
    }
    
    query += ` ORDER BY ps.scheduled_date, ps.scheduled_time, v.sort_order`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching programming schedule:', error);
    res.status(500).json({ error: 'Failed to fetch programming schedule' });
  }
});

// Get programming entry by ID with full details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        ps.*,
        v.name_cs as venue_name_cs,
        v.name_en as venue_name_en,
        v.capacity as venue_capacity,
        -- Movie details (if single movie)
        m.name_cs as movie_name_cs,
        m.name_en as movie_name_en,
        m.director as movie_director,
        m.runtime as movie_runtime,
        m.section as movie_section,
        m.synopsis_cs as movie_synopsis_cs,
        m.synopsis_en as movie_synopsis_en,
        -- Block details (if block)
        mb.name_cs as block_name_cs,
        mb.name_en as block_name_en,
        mb.description_cs as block_description_cs,
        mb.description_en as block_description_en
      FROM programming_schedule ps
      JOIN venues v ON ps.venue_id = v.id
      LEFT JOIN movies m ON ps.movie_id = m.id
      LEFT JOIN movie_blocks mb ON ps.block_id = mb.id
      WHERE ps.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Programming entry not found' });
    }
    
    const entry = result.rows[0];
    
    // If it's a block, get the movies in the block
    if (entry.block_id) {
      const moviesResult = await pool.query(`
        SELECT 
          m.*,
          bm.sort_order
        FROM block_movies bm
        JOIN movies m ON bm.movie_id = m.id
        WHERE bm.block_id = $1
        ORDER BY bm.sort_order, m.name_cs
      `, [entry.block_id]);
      
      entry.block_movies = moviesResult.rows;
    }
    
    res.json(entry);
  } catch (error) {
    console.error('Error fetching programming entry:', error);
    res.status(500).json({ error: 'Failed to fetch programming entry' });
  }
});

// Create new programming entry
router.post('/', async (req, res) => {
  try {
    const {
      edition_id,
      venue_id,
      movie_id,
      block_id,
      scheduled_date,
      scheduled_time,
      discussion_time,
      title_override_cs,
      title_override_en,
      notes
    } = req.body;
    
    
    // Validate required fields
    if (!edition_id || !venue_id || !scheduled_date || !scheduled_time) {
      return res.status(400).json({ 
        error: 'Edition ID, venue ID, date, and time are required' 
      });
    }
    
    // Validate that either movie_id or block_id is provided, but not both
    if ((!movie_id && !block_id) || (movie_id && block_id)) {
      return res.status(400).json({ 
        error: 'Either movie ID or block ID must be provided, but not both' 
      });
    }
    
    // Check for time overlaps
    const overlapCheck = await checkTimeOverlap(
      venue_id, scheduled_date, scheduled_time, 
      movie_id, block_id, discussion_time
    );
    
    if (overlapCheck.hasOverlap) {
      const { conflictDetails } = overlapCheck;
      return res.status(400).json({ 
        error: `Time overlap detected! New entry (${conflictDetails.newStart}-${conflictDetails.newEnd}) overlaps with existing entry (${conflictDetails.existingStart}-${conflictDetails.existingEnd})` 
      });
    }
    
    const result = await pool.query(`
      INSERT INTO programming_schedule (
        edition_id, venue_id, movie_id, block_id, scheduled_date, scheduled_time,
        discussion_time, title_override_cs, title_override_en, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      edition_id, venue_id, movie_id || null, block_id || null, 
      scheduled_date, scheduled_time, discussion_time || 0,
      title_override_cs || null, title_override_en || null, notes || null
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating programming entry:', error);
    res.status(500).json({ error: 'Failed to create programming entry' });
  }
});

// Update programming entry
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      venue_id,
      scheduled_date,
      scheduled_time,
      discussion_time,
      title_override_cs,
      title_override_en,
      notes
    } = req.body;
    
    // Check for time overlaps (excluding current entry)
    if (venue_id && scheduled_date && scheduled_time) {
      // Get current entry details to determine movie/block
      const currentEntry = await pool.query(
        'SELECT movie_id, block_id FROM programming_schedule WHERE id = $1', 
        [id]
      );
      
      if (currentEntry.rows.length === 0) {
        return res.status(404).json({ error: 'Programming entry not found' });
      }
      
      const { movie_id: currentMovieId, block_id: currentBlockId } = currentEntry.rows[0];
      
      const overlapCheck = await checkTimeOverlap(
        venue_id, scheduled_date, scheduled_time, 
        currentMovieId, currentBlockId, discussion_time, id
      );
      
      if (overlapCheck.hasOverlap) {
        const { conflictDetails } = overlapCheck;
        return res.status(400).json({ 
          error: `Time overlap detected! Updated entry (${conflictDetails.newStart}-${conflictDetails.newEnd}) would overlap with existing entry (${conflictDetails.existingStart}-${conflictDetails.existingEnd})` 
        });
      }
    }
    
    const result = await pool.query(`
      UPDATE programming_schedule 
      SET 
        venue_id = COALESCE($1, venue_id),
        scheduled_date = COALESCE($2, scheduled_date),
        scheduled_time = COALESCE($3, scheduled_time),
        discussion_time = COALESCE($4, discussion_time),
        title_override_cs = $5,
        title_override_en = $6,
        notes = $7
      WHERE id = $8
      RETURNING *
    `, [
      venue_id, scheduled_date, scheduled_time, discussion_time,
      title_override_cs, title_override_en, notes, id
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Programming entry not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating programming entry:', error);
    res.status(500).json({ error: 'Failed to update programming entry' });
  }
});

// Delete programming entry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM programming_schedule WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Programming entry not found' });
    }
    
    res.json({ message: 'Programming entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting programming entry:', error);
    res.status(500).json({ error: 'Failed to delete programming entry' });
  }
});

// Get available time slots for a venue on a specific date
router.get('/availability/:venueId/:date', async (req, res) => {
  try {
    const { venueId, date } = req.params;
    
    const bookedSlots = await pool.query(`
      SELECT scheduled_time, total_runtime
      FROM programming_schedule 
      WHERE venue_id = $1 AND scheduled_date = $2
      ORDER BY scheduled_time
    `, [venueId, date]);
    
    res.json({
      venue_id: venueId,
      date: date,
      booked_slots: bookedSlots.rows
    });
  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

// Get programming statistics for an edition
router.get('/stats/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(CASE WHEN movie_id IS NOT NULL THEN 1 END) as single_movies,
        COUNT(CASE WHEN block_id IS NOT NULL THEN 1 END) as blocks,
        COUNT(DISTINCT venue_id) as venues_used,
        COUNT(DISTINCT scheduled_date) as programming_days,
        COALESCE(SUM(total_runtime), 0) as total_runtime_minutes
      FROM programming_schedule 
      WHERE edition_id = $1
    `, [editionId]);
    
    const venueStats = await pool.query(`
      SELECT 
        v.name_cs as venue_name,
        COUNT(ps.id) as entries_count,
        COALESCE(SUM(ps.total_runtime), 0) as total_runtime_minutes
      FROM venues v
      LEFT JOIN programming_schedule ps ON v.id = ps.venue_id AND ps.edition_id = $1
      WHERE v.active = true
      GROUP BY v.id, v.name_cs, v.sort_order
      ORDER BY v.sort_order
    `, [editionId]);
    
    res.json({
      overview: stats.rows[0],
      by_venue: venueStats.rows
    });
  } catch (error) {
    console.error('Error fetching programming stats:', error);
    res.status(500).json({ error: 'Failed to fetch programming statistics' });
  }
});

module.exports = router;