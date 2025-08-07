const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Apply authentication to all routes
router.use(requireAuth);

// HOTELS ROUTES

// GET /api/accommodation/hotels/:editionId - List hotels for an edition
router.get('/hotels/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT h.*, 
             COUNT(rt.id) as room_types_count,
             e.name as edition_name
      FROM hotels h
      LEFT JOIN room_types rt ON h.id = rt.hotel_id AND rt.active = true
      JOIN editions e ON h.edition_id = e.id
      WHERE h.edition_id = $1
      GROUP BY h.id, e.name
      ORDER BY h.sort_order, h.name
    `, [editionId]);
    
    res.json({ hotels: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'list_hotels', editionId: req.params.editionId });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/accommodation/hotels - Create new hotel
router.post('/hotels', async (req, res) => {
  try {
    const { 
      edition_id, 
      name, 
      address, 
      description, 
      contact_phone, 
      contact_email, 
      website,
      sort_order = 0 
    } = req.body;
    
    if (!edition_id || !name) {
      return res.status(400).json({ error: 'Edition ID and name are required' });
    }
    
    const result = await pool.query(`
      INSERT INTO hotels (edition_id, name, address, description, contact_phone, contact_email, website, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [edition_id, name, address, description, contact_phone, contact_email, website, sort_order]);
    
    res.status(201).json({ hotel: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'create_hotel' });
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/accommodation/hotels/:id - Update hotel
router.put('/hotels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      address, 
      description, 
      contact_phone, 
      contact_email, 
      website,
      active,
      sort_order 
    } = req.body;
    
    const result = await pool.query(`
      UPDATE hotels 
      SET name = COALESCE($2, name),
          address = COALESCE($3, address),
          description = COALESCE($4, description),
          contact_phone = COALESCE($5, contact_phone),
          contact_email = COALESCE($6, contact_email),
          website = COALESCE($7, website),
          active = COALESCE($8, active),
          sort_order = COALESCE($9, sort_order),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id, name, address, description, contact_phone, contact_email, website, active, sort_order]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Hotel not found' });
    }
    
    res.json({ hotel: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'update_hotel', hotelId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/accommodation/hotels/:id - Delete hotel
router.delete('/hotels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM hotels WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Hotel not found' });
    }
    
    res.json({ message: 'Hotel deleted successfully' });
  } catch (error) {
    logError(error, req, { operation: 'delete_hotel', hotelId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// ROOM TYPES ROUTES

// GET /api/accommodation/room-types/:hotelId - List room types for a hotel
router.get('/room-types/:hotelId', async (req, res) => {
  try {
    const { hotelId } = req.params;
    
    const result = await pool.query(`
      SELECT rt.*, h.name as hotel_name
      FROM room_types rt
      JOIN hotels h ON rt.hotel_id = h.id
      WHERE rt.hotel_id = $1
      ORDER BY rt.sort_order, rt.name
    `, [hotelId]);
    
    res.json({ roomTypes: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'list_room_types', hotelId: req.params.hotelId });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/accommodation/room-types - Create new room type
router.post('/room-types', async (req, res) => {
  try {
    const { 
      hotel_id, 
      name, 
      description, 
      capacity, 
      price_per_night, 
      currency = 'CZK',
      amenities = [],
      sort_order = 0 
    } = req.body;
    
    if (!hotel_id || !name || !capacity || capacity < 1) {
      return res.status(400).json({ error: 'Hotel ID, name, and valid capacity are required' });
    }
    
    const result = await pool.query(`
      INSERT INTO room_types (hotel_id, name, description, capacity, price_per_night, currency, amenities, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [hotel_id, name, description, capacity, price_per_night, currency, amenities, sort_order]);
    
    res.status(201).json({ roomType: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'create_room_type' });
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/accommodation/room-types/:id - Update room type
router.put('/room-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      description, 
      capacity, 
      price_per_night, 
      currency,
      amenities,
      active,
      sort_order 
    } = req.body;
    
    const result = await pool.query(`
      UPDATE room_types 
      SET name = COALESCE($2, name),
          description = COALESCE($3, description),
          capacity = COALESCE($4, capacity),
          price_per_night = COALESCE($5, price_per_night),
          currency = COALESCE($6, currency),
          amenities = COALESCE($7, amenities),
          active = COALESCE($8, active),
          sort_order = COALESCE($9, sort_order),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id, name, description, capacity, price_per_night, currency, amenities, active, sort_order]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room type not found' });
    }
    
    res.json({ roomType: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'update_room_type', roomTypeId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/accommodation/room-types/:id - Delete room type
router.delete('/room-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM room_types WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room type not found' });
    }
    
    res.json({ message: 'Room type deleted successfully' });
  } catch (error) {
    logError(error, req, { operation: 'delete_room_type', roomTypeId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// ROOM AVAILABILITY ROUTES

// GET /api/accommodation/availability/:roomTypeId - Get availability for a room type
router.get('/availability/:roomTypeId', async (req, res) => {
  try {
    const { roomTypeId } = req.params;
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT 
        ra.id,
        ra.room_type_id,
        TO_CHAR(ra.available_date, 'YYYY-MM-DD') as available_date,
        ra.total_rooms,
        ra.reserved_rooms,
        ra.available_rooms,
        ra.notes,
        ra.created_at,
        ra.updated_at,
        rt.name as room_type_name,
        h.name as hotel_name
      FROM room_availability ra
      JOIN room_types rt ON ra.room_type_id = rt.id
      JOIN hotels h ON rt.hotel_id = h.id
      WHERE ra.room_type_id = $1
    `;
    
    const params = [roomTypeId];
    
    if (start_date) {
      params.push(start_date);
      query += ` AND ra.available_date >= $${params.length}`;
    }
    
    if (end_date) {
      params.push(end_date);
      query += ` AND ra.available_date <= $${params.length}`;
    }
    
    query += ` ORDER BY ra.available_date`;
    
    const result = await pool.query(query, params);
    
    res.json({ availability: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_room_availability', roomTypeId: req.params.roomTypeId });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/accommodation/availability/bulk - Bulk update availability for date range
router.post('/availability/bulk', async (req, res) => {
  try {
    const { room_type_id, start_date, end_date, total_rooms, notes } = req.body;
    
    if (!room_type_id || !start_date || !end_date || total_rooms === undefined) {
      return res.status(400).json({ error: 'Room type ID, date range, and total rooms are required' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Generate dates between start and end
      const dates = [];
      let currentDate = new Date(start_date);
      const endDateObj = new Date(end_date);
      
      while (currentDate <= endDateObj) {
        dates.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      // Insert or update availability for each date
      for (const date of dates) {
        await client.query(`
          INSERT INTO room_availability (room_type_id, available_date, total_rooms, notes)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (room_type_id, available_date)
          DO UPDATE SET 
            total_rooms = $3,
            notes = COALESCE($4, room_availability.notes),
            updated_at = CURRENT_TIMESTAMP
        `, [room_type_id, date, total_rooms, notes]);
      }
      
      await client.query('COMMIT');
      
      res.json({ message: `Availability updated for ${dates.length} dates` });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logError(error, req, { operation: 'bulk_update_availability' });
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/accommodation/availability/:id - Update single availability record
router.put('/availability/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { total_rooms, notes } = req.body;
    
    const result = await pool.query(`
      UPDATE room_availability 
      SET total_rooms = COALESCE($2, total_rooms),
          notes = COALESCE($3, notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id, total_rooms, notes]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Availability record not found' });
    }
    
    res.json({ availability: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'update_availability', availabilityId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// GUEST ROOM ASSIGNMENTS

// POST /api/accommodation/assign - Assign guest to room
router.post('/assign', async (req, res) => {
  try {
    const {
      invitation_id,
      room_type_id,
      check_in_date,
      check_out_date,
      guests_count = 1,
      notes
    } = req.body;

    if (!invitation_id || !room_type_id || !check_in_date || !check_out_date) {
      return res.status(400).json({ error: 'Invitation ID, room type, check-in and check-out dates are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if guest already has a room assignment
      const existingAssignment = await client.query(
        'SELECT id FROM guest_room_reservations WHERE invitation_id = $1 AND status != $2',
        [invitation_id, 'cancelled']
      );

      if (existingAssignment.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Guest already has a room assignment' });
      }

      // Check room availability for the selected dates
      const availabilityCheck = await client.query(`
        SELECT ra.available_date, ra.available_rooms, rt.name as room_type_name, h.name as hotel_name
        FROM room_availability ra
        JOIN room_types rt ON ra.room_type_id = rt.id
        JOIN hotels h ON rt.hotel_id = h.id
        WHERE ra.room_type_id = $1 
          AND ra.available_date >= $2 
          AND ra.available_date < $3
          AND ra.available_rooms > 0
        ORDER BY ra.available_date
      `, [room_type_id, check_in_date, check_out_date]);

      // Calculate required nights
      const checkIn = new Date(check_in_date);
      const checkOut = new Date(check_out_date);
      const requiredNights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

      if (availabilityCheck.rows.length < requiredNights) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Insufficient availability. Need ${requiredNights} nights, only ${availabilityCheck.rows.length} available.` 
        });
      }

      // Create the reservation
      const reservationResult = await client.query(`
        INSERT INTO guest_room_reservations (invitation_id, room_type_id, check_in_date, check_out_date, guests_count, notes, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')
        RETURNING *
      `, [invitation_id, room_type_id, check_in_date, check_out_date, guests_count, notes]);

      // Update availability (reserve the rooms)
      for (const availability of availabilityCheck.rows) {
        await client.query(`
          UPDATE room_availability 
          SET reserved_rooms = reserved_rooms + 1
          WHERE room_type_id = $1 AND available_date = $2
        `, [room_type_id, availability.available_date]);
      }

      await client.query('COMMIT');

      // Return the reservation with hotel/room info
      const fullReservation = await pool.query(`
        SELECT grr.*, rt.name as room_type_name, h.name as hotel_name, rt.capacity,
               g.first_name || ' ' || g.last_name as guest_name
        FROM guest_room_reservations grr
        JOIN room_types rt ON grr.room_type_id = rt.id
        JOIN hotels h ON rt.hotel_id = h.id
        JOIN guest_invitations gi ON grr.invitation_id = gi.id
        JOIN guests g ON gi.guest_id = g.id
        WHERE grr.id = $1
      `, [reservationResult.rows[0].id]);

      res.status(201).json({ reservation: fullReservation.rows[0] });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logError(error, req, { operation: 'assign_room' });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/accommodation/assignments/:editionId - Get all room assignments for edition
router.get('/assignments/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;

    const result = await pool.query(`
      SELECT 
             grr.id,
             grr.invitation_id,
             grr.room_type_id,
             TO_CHAR(grr.check_in_date, 'YYYY-MM-DD') as check_in_date,
             TO_CHAR(grr.check_out_date, 'YYYY-MM-DD') as check_out_date,
             grr.guests_count,
             grr.notes,
             grr.status,
             grr.created_at,
             grr.updated_at,
             grr.room_group_id,
             grr.is_primary_booking,
             grr.room_number,
             rt.name as room_type_name, h.name as hotel_name, rt.capacity,
             g.first_name || ' ' || g.last_name as guest_name, g.email,
             gi.accommodation, gi.covered_nights,
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
             ) as category,
             -- Get room sharing info
             CASE 
               WHEN grr.room_group_id IS NOT NULL THEN (
                 SELECT string_agg(g2.first_name || ' ' || g2.last_name, ', ' ORDER BY grr2.is_primary_booking DESC, g2.last_name)
                 FROM guest_room_reservations grr2
                 JOIN guest_invitations gi2 ON grr2.invitation_id = gi2.id
                 JOIN guests g2 ON gi2.guest_id = g2.id
                 WHERE grr2.room_group_id = grr.room_group_id 
                   AND grr2.status != 'cancelled'
                   AND grr2.invitation_id != grr.invitation_id
               )
               ELSE NULL
             END as roommates,
             CASE 
               WHEN grr.room_group_id IS NOT NULL THEN (
                 SELECT count(*)
                 FROM guest_room_reservations grr2
                 WHERE grr2.room_group_id = grr.room_group_id 
                   AND grr2.status != 'cancelled'
               )
               ELSE 1
             END as total_guests_in_room
      FROM guest_room_reservations grr
      JOIN room_types rt ON grr.room_type_id = rt.id
      JOIN hotels h ON rt.hotel_id = h.id
      JOIN guest_invitations gi ON grr.invitation_id = gi.id
      JOIN guests g ON gi.guest_id = g.id
      WHERE gi.edition_id = $1 AND grr.status != 'cancelled'
      ORDER BY h.sort_order, h.name, rt.sort_order, rt.name, grr.is_primary_booking DESC, g.last_name, g.first_name
    `, [editionId]);

    res.json({ assignments: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_room_assignments', editionId: req.params.editionId });
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/accommodation/assignments/:id - Cancel room assignment
router.delete('/assignments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get reservation details
      const reservationResult = await client.query(
        'SELECT * FROM guest_room_reservations WHERE id = $1 AND status != $2',
        [id, 'cancelled']
      );

      if (reservationResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Room assignment not found' });
      }

      const reservation = reservationResult.rows[0];

      // Update availability (free up the rooms)
      await client.query(`
        UPDATE room_availability 
        SET reserved_rooms = reserved_rooms - 1
        WHERE room_type_id = $1 
          AND available_date >= $2 
          AND available_date < $3
          AND reserved_rooms > 0
      `, [reservation.room_type_id, reservation.check_in_date, reservation.check_out_date]);

      // Cancel the reservation
      await client.query(
        'UPDATE guest_room_reservations SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id, 'cancelled']
      );

      await client.query('COMMIT');

      res.json({ message: 'Room assignment cancelled successfully' });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logError(error, req, { operation: 'cancel_room_assignment', assignmentId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/accommodation/available-rooms/:editionId - Get available rooms for assignment
router.get('/available-rooms/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    const { check_in_date, check_out_date } = req.query;

    if (!check_in_date || !check_out_date) {
      return res.status(400).json({ error: 'Check-in and check-out dates are required' });
    }

    const result = await pool.query(`
      SELECT 
        h.id as hotel_id,
        h.name as hotel_name,
        h.sort_order as hotel_sort_order,
        rt.id as room_type_id,
        rt.name as room_type_name,
        rt.capacity,
        rt.price_per_night,
        rt.currency,
        rt.amenities,
        rt.sort_order as room_type_sort_order,
        MIN(ra.available_rooms) as min_available_rooms
      FROM hotels h
      JOIN room_types rt ON h.id = rt.hotel_id
      JOIN room_availability ra ON rt.id = ra.room_type_id
      WHERE h.edition_id = $1 
        AND h.active = true 
        AND rt.active = true
        AND ra.available_rooms > 0
        AND ra.available_date >= $2 
        AND ra.available_date < $3
      GROUP BY h.id, h.name, h.sort_order, rt.id, rt.name, rt.capacity, rt.price_per_night, rt.currency, rt.amenities, rt.sort_order
      HAVING COUNT(ra.available_date) = (
        SELECT COUNT(*)
        FROM generate_series($2::date, $3::date - interval '1 day', interval '1 day')
      )
      ORDER BY h.sort_order, h.name, rt.sort_order, rt.name
    `, [editionId, check_in_date, check_out_date]);

    // Group by hotel
    const hotels = {};
    result.rows.forEach(row => {
      if (!hotels[row.hotel_id]) {
        hotels[row.hotel_id] = {
          hotel_id: row.hotel_id,
          hotel_name: row.hotel_name,
          room_types: []
        };
      }
      hotels[row.hotel_id].room_types.push({
        room_type_id: row.room_type_id,
        room_type_name: row.room_type_name,
        capacity: row.capacity,
        price_per_night: row.price_per_night,
        currency: row.currency,
        amenities: row.amenities,
        available_rooms: row.min_available_rooms
      });
    });

    res.json({ hotels: Object.values(hotels) });
  } catch (error) {
    logError(error, req, { operation: 'get_available_rooms', editionId: req.params.editionId });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/accommodation/overview/:editionId - Get accommodation overview for edition
router.get('/overview/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        h.id as hotel_id,
        h.name as hotel_name,
        rt.id as room_type_id,
        rt.name as room_type_name,
        rt.capacity,
        rt.price_per_night,
        rt.currency,
        COUNT(ra.id) as availability_days,
        SUM(ra.total_rooms) as total_room_nights,
        SUM(ra.reserved_rooms) as reserved_room_nights,
        SUM(ra.available_rooms) as available_room_nights
      FROM hotels h
      LEFT JOIN room_types rt ON h.id = rt.hotel_id AND rt.active = true
      LEFT JOIN room_availability ra ON rt.id = ra.room_type_id
      WHERE h.edition_id = $1 AND h.active = true
      GROUP BY h.id, h.name, rt.id, rt.name, rt.capacity, rt.price_per_night, rt.currency
      ORDER BY h.sort_order, h.name, rt.sort_order, rt.name
    `, [editionId]);
    
    res.json({ overview: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_accommodation_overview', editionId: req.params.editionId });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/accommodation/assign-multiple - Assign multiple guests to the same room
router.post('/assign-multiple', async (req, res) => {
  try {
    const {
      invitation_ids, // Array of invitation IDs
      room_type_id,
      check_in_date,
      check_out_date,
      primary_invitation_id, // Which guest is the primary contact
      notes
    } = req.body;

    if (!invitation_ids || !Array.isArray(invitation_ids) || invitation_ids.length === 0) {
      return res.status(400).json({ error: 'At least one invitation ID is required' });
    }

    if (!room_type_id || !check_in_date || !check_out_date) {
      return res.status(400).json({ error: 'Room type, check-in and check-out dates are required' });
    }

    if (!primary_invitation_id || !invitation_ids.includes(primary_invitation_id)) {
      return res.status(400).json({ error: 'Primary invitation must be one of the selected guests' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if any guest already has a room assignment
      const existingAssignments = await client.query(`
        SELECT invitation_id, id FROM guest_room_reservations 
        WHERE invitation_id = ANY($1) AND status != 'cancelled'
      `, [invitation_ids]);

      if (existingAssignments.rows.length > 0) {
        await client.query('ROLLBACK');
        const assignedGuests = existingAssignments.rows.map(r => r.invitation_id);
        return res.status(409).json({ 
          error: 'Some guests already have room assignments',
          assigned_invitations: assignedGuests
        });
      }

      // Check room capacity
      const roomTypeResult = await client.query(`
        SELECT capacity, name FROM room_types WHERE id = $1
      `, [room_type_id]);

      if (roomTypeResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Room type not found' });
      }

      const roomCapacity = roomTypeResult.rows[0].capacity;
      if (invitation_ids.length > roomCapacity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Too many guests for room capacity. Room capacity: ${roomCapacity}, guests: ${invitation_ids.length}` 
        });
      }

      // Check room availability for the selected dates
      const availabilityCheck = await client.query(`
        SELECT ra.available_date, ra.available_rooms, rt.name as room_type_name, h.name as hotel_name
        FROM room_availability ra
        JOIN room_types rt ON ra.room_type_id = rt.id
        JOIN hotels h ON rt.hotel_id = h.id
        WHERE ra.room_type_id = $1 
          AND ra.available_date >= $2 
          AND ra.available_date < $3
          AND ra.available_rooms > 0
        ORDER BY ra.available_date
      `, [room_type_id, check_in_date, check_out_date]);

      // Calculate required nights
      const checkIn = new Date(check_in_date);
      const checkOut = new Date(check_out_date);
      const requiredNights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

      if (availabilityCheck.rows.length < requiredNights) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: 'Room not available for all requested dates',
          available_nights: availabilityCheck.rows.length,
          required_nights: requiredNights
        });
      }

      // Generate a UUID for the room group
      const roomGroupId = await client.query('SELECT gen_random_uuid() as id');
      const groupId = roomGroupId.rows[0].id;

      // Create reservations for all guests
      const reservations = [];
      for (const invitationId of invitation_ids) {
        const isPrimary = invitationId === primary_invitation_id;
        
        const reservationResult = await client.query(`
          INSERT INTO guest_room_reservations (
            invitation_id, room_type_id, check_in_date, check_out_date, 
            guests_count, notes, status, room_group_id, is_primary_booking
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8)
          RETURNING *
        `, [invitationId, room_type_id, check_in_date, check_out_date, 
            1, notes, groupId, isPrimary]);

        reservations.push(reservationResult.rows[0]);
      }

      // Update availability (reserve ONE room for the entire group)
      for (const availability of availabilityCheck.rows) {
        await client.query(`
          UPDATE room_availability 
          SET reserved_rooms = reserved_rooms + 1
          WHERE room_type_id = $1 AND available_date = $2
        `, [room_type_id, availability.available_date]);
      }

      await client.query('COMMIT');

      // Return the reservations with hotel/room info
      const fullReservations = await pool.query(`
        SELECT grr.*, rt.name as room_type_name, h.name as hotel_name, rt.capacity,
               g.first_name || ' ' || g.last_name as guest_name
        FROM guest_room_reservations grr
        JOIN room_types rt ON grr.room_type_id = rt.id
        JOIN hotels h ON rt.hotel_id = h.id
        JOIN guest_invitations gi ON grr.invitation_id = gi.id
        JOIN guests g ON gi.guest_id = g.id
        WHERE grr.room_group_id = $1
        ORDER BY grr.is_primary_booking DESC, g.last_name, g.first_name
      `, [groupId]);

      res.status(201).json({ 
        reservations: fullReservations.rows,
        room_group_id: groupId,
        message: `Successfully assigned ${invitation_ids.length} guests to shared room`
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logError(error, req, { operation: 'assign_multiple_guests_room' });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/accommodation/add-to-room - Add a guest to an existing room group
router.post('/add-to-room', async (req, res) => {
  try {
    const {
      invitation_id,
      room_group_id,
      existing_assignment_id
    } = req.body;

    if (!invitation_id || (!room_group_id && !existing_assignment_id)) {
      return res.status(400).json({ error: 'Invitation ID and either room group ID or existing assignment ID are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if guest already has a room assignment
      const existingAssignment = await client.query(
        'SELECT id FROM guest_room_reservations WHERE invitation_id = $1 AND status != $2',
        [invitation_id, 'cancelled']
      );

      if (existingAssignment.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Guest already has a room assignment' });
      }

      let roomGroup;
      let newRoomGroupId = room_group_id;

      if (room_group_id) {
        // Adding to existing shared room
        const roomGroupResult = await client.query(`
          SELECT grr.room_type_id, grr.check_in_date, grr.check_out_date, grr.notes,
                 rt.capacity, rt.name as room_type_name, h.name as hotel_name,
                 COUNT(*) as current_guests
          FROM guest_room_reservations grr
          JOIN room_types rt ON grr.room_type_id = rt.id
          JOIN hotels h ON rt.hotel_id = h.id
          WHERE grr.room_group_id = $1 AND grr.status != 'cancelled'
          GROUP BY grr.room_type_id, grr.check_in_date, grr.check_out_date, grr.notes,
                   rt.capacity, rt.name, h.name
        `, [room_group_id]);

        if (roomGroupResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Room group not found' });
        }
        roomGroup = roomGroupResult.rows[0];
      } else {
        // Converting individual room to shared room
        const existingAssignmentResult = await client.query(`
          SELECT grr.*, rt.capacity, rt.name as room_type_name, h.name as hotel_name
          FROM guest_room_reservations grr
          JOIN room_types rt ON grr.room_type_id = rt.id
          JOIN hotels h ON rt.hotel_id = h.id
          WHERE grr.id = $1 AND grr.status != 'cancelled'
        `, [existing_assignment_id]);

        if (existingAssignmentResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Existing assignment not found' });
        }

        const existingAssignment = existingAssignmentResult.rows[0];
        
        // Create a new room group ID and update the existing assignment
        newRoomGroupId = require('crypto').randomUUID();
        
        await client.query(`
          UPDATE guest_room_reservations 
          SET room_group_id = $1, is_primary_booking = true 
          WHERE id = $2
        `, [newRoomGroupId, existing_assignment_id]);

        roomGroup = {
          room_type_id: existingAssignment.room_type_id,
          check_in_date: existingAssignment.check_in_date,
          check_out_date: existingAssignment.check_out_date,
          notes: existingAssignment.notes,
          capacity: existingAssignment.capacity,
          room_type_name: existingAssignment.room_type_name,
          hotel_name: existingAssignment.hotel_name,
          current_guests: 1 // The existing guest
        };
      }
      
      // Check room capacity
      if (roomGroup.current_guests >= roomGroup.capacity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Room is at full capacity. Capacity: ${roomGroup.capacity}, current guests: ${roomGroup.current_guests}` 
        });
      }

      // Create reservation for the new guest
      const reservationResult = await client.query(`
        INSERT INTO guest_room_reservations (
          invitation_id, room_type_id, check_in_date, check_out_date, 
          guests_count, notes, status, room_group_id, is_primary_booking
        )
        VALUES ($1, $2, $3, $4, 1, $5, 'confirmed', $6, false)
        RETURNING *
      `, [invitation_id, roomGroup.room_type_id, roomGroup.check_in_date, 
          roomGroup.check_out_date, roomGroup.notes, newRoomGroupId]);

      await client.query('COMMIT');

      // Return the reservation with hotel/room info
      const fullReservation = await pool.query(`
        SELECT grr.*, rt.name as room_type_name, h.name as hotel_name, rt.capacity,
               g.first_name || ' ' || g.last_name as guest_name
        FROM guest_room_reservations grr
        JOIN room_types rt ON grr.room_type_id = rt.id
        JOIN hotels h ON rt.hotel_id = h.id
        JOIN guest_invitations gi ON grr.invitation_id = gi.id
        JOIN guests g ON gi.guest_id = g.id
        WHERE grr.id = $1
      `, [reservationResult.rows[0].id]);

      res.status(201).json({ 
        reservation: fullReservation.rows[0],
        message: `Successfully added guest to shared room`
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logError(error, req, { operation: 'add_guest_to_room' });
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/accommodation/assignments/:id/room-number - Update room number for assignment
router.put('/assignments/:id/room-number', async (req, res) => {
  try {
    const { id } = req.params;
    const { room_number } = req.body;

    if (room_number === undefined) {
      return res.status(400).json({ error: 'Room number is required' });
    }

    // Update the room number
    const result = await pool.query(`
      UPDATE guest_room_reservations 
      SET room_number = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND status != 'cancelled'
      RETURNING *
    `, [room_number || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room assignment not found' });
    }

    res.json({ 
      message: 'Room number updated successfully',
      assignment: result.rows[0]
    });
  } catch (error) {
    logError(error, req, { operation: 'update_room_number', assignmentId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/accommodation/room-groups/:editionId - Get all room sharing groups for an edition
router.get('/room-groups/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;

    const result = await pool.query(`
      SELECT 
        rsg.group_id,
        rsg.room_type,
        rsg.hotel,
        rsg.check_in_date,
        rsg.check_out_date,
        rsg.room_capacity,
        rsg.guests_in_room,
        rsg.guest_names,
        rsg.invitation_ids,
        rsg.reservation_ids,
        rsg.primary_reservation_id,
        -- Get detailed guest information
        json_agg(
          json_build_object(
            'invitation_id', gi.id,
            'guest_id', g.id,
            'guest_name', g.first_name || ' ' || g.last_name,
            'guest_email', g.email,
            'is_primary', grr.is_primary_booking
          ) ORDER BY grr.is_primary_booking DESC, g.last_name, g.first_name
        ) as guests
      FROM room_sharing_groups rsg
      JOIN guest_room_reservations grr ON grr.room_group_id = rsg.group_id OR grr.id = rsg.group_id
      JOIN guest_invitations gi ON grr.invitation_id = gi.id
      JOIN guests g ON gi.guest_id = g.id
      WHERE gi.edition_id = $1
      GROUP BY rsg.group_id, rsg.room_type, rsg.hotel, rsg.check_in_date, rsg.check_out_date,
               rsg.room_capacity, rsg.guests_in_room, rsg.guest_names, rsg.invitation_ids,
               rsg.reservation_ids, rsg.primary_reservation_id
      ORDER BY rsg.hotel, rsg.room_type, rsg.check_in_date
    `, [editionId]);

    res.json({ room_groups: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_room_groups', editionId: req.params.editionId });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;