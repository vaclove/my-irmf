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
      SELECT ra.*, rt.name as room_type_name, h.name as hotel_name
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

module.exports = router;