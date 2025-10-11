const express = require('express');
const { pool } = require('../models/database');
const router = express.Router();

// Get badge layouts for edition
router.get('/layouts/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        id,
        name,
        canvas_width_mm,
        canvas_height_mm,
        background_color,
        background_image,
        layout_data,
        created_at,
        updated_at
      FROM badge_layouts 
      WHERE edition_id = $1
      ORDER BY created_at DESC
    `, [editionId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching badge layouts:', error);
    res.status(500).json({ error: 'Failed to fetch badge layouts' });
  }
});

// Create new badge layout
router.post('/layouts', async (req, res) => {
  try {
    const {
      edition_id,
      name,
      canvas_width_mm,
      canvas_height_mm,
      background_color,
      background_image,
      layout_data
    } = req.body;
    
    const result = await pool.query(`
      INSERT INTO badge_layouts (
        edition_id, name, canvas_width_mm, canvas_height_mm,
        background_color, background_image, layout_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [edition_id, name, canvas_width_mm, canvas_height_mm, background_color, background_image, layout_data]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating badge layout:', error);
    res.status(500).json({ error: 'Failed to create badge layout' });
  }
});

// Update badge layout
router.put('/layouts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      canvas_width_mm,
      canvas_height_mm,
      background_color,
      background_image,
      layout_data
    } = req.body;
    
    const result = await pool.query(`
      UPDATE badge_layouts 
      SET 
        name = $1,
        canvas_width_mm = $2,
        canvas_height_mm = $3,
        background_color = $4,
        background_image = $5,
        layout_data = $6,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *
    `, [name, canvas_width_mm, canvas_height_mm, background_color, background_image, layout_data, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Badge layout not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating badge layout:', error);
    res.status(500).json({ error: 'Failed to update badge layout' });
  }
});

// Delete badge layout
router.delete('/layouts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM badge_layouts WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Badge layout not found' });
    }
    
    res.json({ message: 'Badge layout deleted successfully' });
  } catch (error) {
    console.error('Error deleting badge layout:', error);
    res.status(500).json({ error: 'Failed to delete badge layout' });
  }
});

// Get category assignments for edition
router.get('/assignments/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        cba.id,
        cba.category,
        cba.layout_id,
        bl.name as layout_name
      FROM category_badge_assignments cba
      LEFT JOIN badge_layouts bl ON cba.layout_id = bl.id
      WHERE cba.edition_id = $1
      ORDER BY cba.category
    `, [editionId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching category assignments:', error);
    res.status(500).json({ error: 'Failed to fetch category assignments' });
  }
});

// Update category assignments for edition
router.put('/assignments/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    const { assignments } = req.body; // Array of { category, layout_id }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete existing assignments for this edition
      await client.query('DELETE FROM category_badge_assignments WHERE edition_id = $1', [editionId]);
      
      // Insert new assignments
      for (const assignment of assignments) {
        if (assignment.layout_id) {
          await client.query(`
            INSERT INTO category_badge_assignments (edition_id, category, layout_id)
            VALUES ($1, $2, $3)
          `, [editionId, assignment.category, assignment.layout_id]);
        }
      }
      
      await client.query('COMMIT');
      res.json({ message: 'Category assignments updated successfully' });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating category assignments:', error);
    res.status(500).json({ error: 'Failed to update category assignments' });
  }
});

// Get badge numbers for edition
router.get('/numbers/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        gbn.id,
        gbn.guest_id,
        gbn.badge_number,
        gbn.assigned_at,
        g.first_name,
        g.last_name,
        g.email,
        e.year
      FROM guest_badge_numbers gbn
      JOIN guests g ON gbn.guest_id = g.id
      JOIN editions e ON gbn.edition_id = e.id
      WHERE gbn.edition_id = $1
      ORDER BY gbn.badge_number
    `, [editionId]);
    
    // Format badge numbers with year prefix
    const formattedResults = result.rows.map(row => ({
      ...row,
      formatted_badge_number: `${row.year}${row.badge_number.toString().padStart(3, '0')}`
    }));
    
    res.json(formattedResults);
  } catch (error) {
    console.error('Error fetching badge numbers:', error);
    res.status(500).json({ error: 'Failed to fetch badge numbers' });
  }
});

// Assign badge number to guest
router.post('/numbers/assign/:guestId/:editionId', async (req, res) => {
  try {
    const { guestId, editionId } = req.params;
    
    // Check if guest already has a badge number for this edition
    const existing = await pool.query(`
      SELECT id FROM guest_badge_numbers 
      WHERE guest_id = $1 AND edition_id = $2
    `, [guestId, editionId]);
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Guest already has a badge number for this edition' });
    }
    
    // Get next badge number and assign it
    const result = await pool.query(`
      INSERT INTO guest_badge_numbers (guest_id, edition_id, badge_number)
      VALUES ($1, $2, get_next_badge_number($2))
      RETURNING id, badge_number
    `, [guestId, editionId]);
    
    // Get edition year for formatting
    const editionResult = await pool.query('SELECT year FROM editions WHERE id = $1', [editionId]);
    const year = editionResult.rows[0].year;
    
    const badgeNumber = result.rows[0].badge_number;
    const formattedBadgeNumber = `${year}${badgeNumber.toString().padStart(3, '0')}`;
    
    res.status(201).json({
      id: result.rows[0].id,
      badge_number: badgeNumber,
      formatted_badge_number: formattedBadgeNumber
    });
  } catch (error) {
    console.error('Error assigning badge number:', error);
    res.status(500).json({ error: 'Failed to assign badge number' });
  }
});

// Generate badge preview
router.get('/preview/:layoutId/:guestId', async (req, res) => {
  try {
    const { layoutId, guestId } = req.params;
    
    // Get layout data
    const layoutResult = await pool.query(`
      SELECT 
        bl.*,
        e.year
      FROM badge_layouts bl
      JOIN editions e ON bl.edition_id = e.id
      WHERE bl.id = $1
    `, [layoutId]);
    
    if (layoutResult.rows.length === 0) {
      return res.status(404).json({ error: 'Badge layout not found' });
    }
    
    // Get guest data
    const guestResult = await pool.query(`
      SELECT 
        g.*,
        gbn.badge_number
      FROM guests g
      LEFT JOIN guest_badge_numbers gbn ON g.id = gbn.guest_id AND gbn.edition_id = $2
      WHERE g.id = $1
    `, [guestId, layoutResult.rows[0].edition_id]);
    
    if (guestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Guest not found' });
    }
    
    const layout = layoutResult.rows[0];
    const guest = guestResult.rows[0];
    
    // Format badge number
    const formattedBadgeNumber = guest.badge_number 
      ? `${layout.year}${guest.badge_number.toString().padStart(3, '0')}`
      : null;
    
    res.json({
      layout,
      guest: {
        ...guest,
        formatted_badge_number: formattedBadgeNumber
      }
    });
  } catch (error) {
    console.error('Error generating badge preview:', error);
    res.status(500).json({ error: 'Failed to generate badge preview' });
  }
});

// Generate badge data for printing
router.get('/print-data/:guestId/:editionId', async (req, res) => {
  try {
    const { guestId, editionId } = req.params;
    console.log('Badge print request:', { guestId, editionId });
    
    // Get guest data with badge number and category for this edition
    // Check both guest_editions (confirmed guests) and guest_invitations (invited but not confirmed)
    const guestResult = await pool.query(`
      SELECT 
        g.*,
        COALESCE(
          ge.category,
          -- If guest not in guest_editions, get category from tags like in invitations
          (SELECT tag_name::guest_category FROM (
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
          'guest'::guest_category
        ) as category,
        gbn.badge_number,
        e.year,
        CASE 
          WHEN ge.id IS NOT NULL THEN 'confirmed'
          WHEN gi.id IS NOT NULL THEN 'invited'
          ELSE NULL
        END as status
      FROM guests g
      LEFT JOIN guest_editions ge ON g.id = ge.guest_id AND ge.edition_id = $2
      LEFT JOIN guest_invitations gi ON g.id = gi.guest_id AND gi.edition_id = $2
      LEFT JOIN guest_badge_numbers gbn ON g.id = gbn.guest_id AND gbn.edition_id = $2
      JOIN editions e ON e.id = $2
      WHERE g.id = $1
        AND (ge.id IS NOT NULL OR gi.id IS NOT NULL)
    `, [guestId, editionId]);
    
    console.log('Guest query result:', guestResult.rows.length);
    
    if (guestResult.rows.length === 0) {
      console.log('Guest not found or not invited to this edition');
      return res.status(404).json({ error: 'Guest not found or not invited to this edition. Please send invitation first.' });
    }
    
    const guest = guestResult.rows[0];
    console.log('Guest found:', { id: guest.id, category: guest.category, badge_number: guest.badge_number });
    
    // Validate that the guest has a category
    if (!guest.category) {
      console.error('Guest has no category assigned:', { guestId: guest.id, email: guest.email });
      return res.status(400).json({ error: 'Guest has no category assigned - cannot determine badge layout' });
    }
    
    const guestCategory = guest.category;
    console.log('Using category:', guestCategory);
    
    // Get category assignment for layout
    const assignmentResult = await pool.query(`
      SELECT 
        cba.layout_id,
        bl.name as layout_name,
        bl.canvas_width_mm,
        bl.canvas_height_mm,
        bl.background_color,
        bl.layout_data
      FROM category_badge_assignments cba
      JOIN badge_layouts bl ON cba.layout_id = bl.id
      WHERE cba.edition_id = $1 AND cba.category = $2
    `, [editionId, guestCategory]);
    
    console.log('Assignment query result:', assignmentResult.rows.length);
    console.log('Looking for:', { editionId, category: guestCategory });
    
    if (assignmentResult.rows.length === 0) {
      // Let's also check what assignments exist
      const allAssignments = await pool.query(`
        SELECT cba.category, cba.layout_id, bl.name as layout_name 
        FROM category_badge_assignments cba
        LEFT JOIN badge_layouts bl ON cba.layout_id = bl.id
        WHERE cba.edition_id = $1
      `, [editionId]);
      
      console.log('All assignments for edition:', allAssignments.rows);
      console.error('No badge layout assigned to category:', guestCategory, 'for edition:', editionId);
      console.error('Guest details:', { id: guest.id, email: guest.email, category: guest.category });
      return res.status(404).json({ 
        error: `No badge layout assigned to guest category '${guestCategory}' for this edition`,
        availableCategories: allAssignments.rows.map(a => a.category)
      });
    }
    
    const layout = assignmentResult.rows[0];
    console.log('Selected layout:', { layout_id: layout.layout_id, layout_name: layout.layout_name, category: guestCategory });
    
    // Format badge number
    const formattedBadgeNumber = guest.badge_number 
      ? `${guest.year}${guest.badge_number.toString().padStart(3, '0')}`
      : null;
    
    // Update badge_printed_at timestamp
    try {
      // Update in guest_editions if confirmed
      if (guest.status === 'confirmed') {
        await pool.query(`
          UPDATE guest_editions 
          SET badge_printed_at = CURRENT_TIMESTAMP 
          WHERE guest_id = $1 AND edition_id = $2
        `, [guestId, editionId]);
      }
      
      // Always update in guest_invitations if invited
      await pool.query(`
        UPDATE guest_invitations 
        SET badge_printed_at = CURRENT_TIMESTAMP 
        WHERE guest_id = $1 AND edition_id = $2
      `, [guestId, editionId]);
      
      console.log('Badge print timestamp updated for guest:', guestId);
    } catch (updateError) {
      console.error('Error updating badge print timestamp:', updateError);
      // Don't fail the request if timestamp update fails
    }

    // Replace Azure photo URL with proxied URL to avoid CORS issues
    const guestWithProxiedPhoto = {
      ...guest,
      formatted_badge_number: formattedBadgeNumber,
      photo: guest.photo ? `/api/guests/${guest.id}/photo` : null
    };

    res.json({
      layout,
      guest: guestWithProxiedPhoto
    });
  } catch (error) {
    console.error('Error getting badge print data:', error);
    res.status(500).json({ error: 'Failed to get badge print data' });
  }
});

module.exports = router;