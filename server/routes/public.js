const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const imageStorage = require('../services/imageStorage');
const mailgunService = require('../utils/mailgun');
const { processTemplate } = require('../utils/templateEngine');
const nodemailer = require('nodemailer');
const router = express.Router();

// Email transporter setup (fallback for SMTP)
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Send email using Mailgun API or SMTP fallback
const sendEmail = async (emailData) => {
  if (mailgunService.isConfigured()) {
    console.log('Sending email via Mailgun API...');
    return await mailgunService.sendEmail(emailData);
  } else if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    console.log('Sending email via SMTP...');
    const transporter = createTransporter();
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: emailData.to,
      subject: emailData.subject,
      html: emailData.html,
    };
    
    // Add CC if provided
    if (emailData.cc) {
      mailOptions.cc = emailData.cc;
    }
    return await transporter.sendMail(mailOptions);
  } else {
    throw new Error('No email service configured. Please set up Mailgun or SMTP settings.');
  }
};

// Get invitation details - public route (no authentication required)
router.get('/invitation/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Find invitation by token
    const result = await pool.query(`
      SELECT gi.*, 
             g.first_name || ' ' || g.last_name as guest_name, 
             g.email, 
             e.name as edition_name,
             e.start_date as edition_start_date,
             e.end_date as edition_end_date,
             gi.accommodation,
             gi.covered_nights,
             et.language,
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
      LEFT JOIN email_templates et ON gi.template_id = et.id
      WHERE gi.token = $1 AND gi.confirmed_at IS NULL
    `, [token]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or already used confirmation token' });
    }
    
    const invitation = result.rows[0];
    
    res.json({
      guest_name: invitation.guest_name,
      email: invitation.email,
      edition_name: invitation.edition_name,
      edition_start_date: invitation.edition_start_date,
      edition_end_date: invitation.edition_end_date,
      category: invitation.category,
      accommodation: invitation.accommodation,
      covered_nights: invitation.covered_nights,
      language: invitation.language || 'english'
    });
    
  } catch (error) {
    logError(error, req, { operation: 'get_invitation_details', token: req.params.token });
    res.status(500).json({ error: error.message });
  }
});

// Confirm invitation - public route (no authentication required)
router.post('/confirm/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { accommodation_dates = [], extra_nights_requested = 0, extra_nights_comment = '' } = req.body;
    
    // Find invitation by token
    const result = await pool.query(`
      SELECT gi.*, g.first_name || ' ' || g.last_name as name, g.email, g.language as guest_language, 
             g.company, g.greeting, e.name as edition_name, e.id as edition_id,
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
             ) as category
      FROM guest_invitations gi
      JOIN guests g ON gi.guest_id = g.id
      JOIN editions e ON gi.edition_id = e.id
      WHERE gi.token = $1 AND gi.confirmed_at IS NULL
    `, [token]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or already used confirmation token' });
    }
    
    const assignment = result.rows[0];
    
    // Start transaction for updating confirmation and accommodation dates
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update confirmation and extra nights request if provided
      const updateParams = [token];
      let updateQuery = 'UPDATE guest_invitations SET confirmed_at = CURRENT_TIMESTAMP';
      
      // Handle extra nights request
      if (extra_nights_requested > 0) {
        updateQuery += ', requested_extra_nights = $2, extra_nights_comment = $3, extra_nights_status = $4';
        updateParams.push(extra_nights_requested, extra_nights_comment || null, 'pending_approval');
      }
      
      updateQuery += ' WHERE token = $1';
      await client.query(updateQuery, updateParams);
      
      // If accommodation dates are provided, store them
      if (assignment.accommodation && accommodation_dates.length > 0) {
        // Create accommodation_selections table if it doesn't exist
        await client.query(`
          CREATE TABLE IF NOT EXISTS accommodation_selections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invitation_id UUID REFERENCES guest_invitations(id) ON DELETE CASCADE,
            selected_date DATE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(invitation_id, selected_date)
          )
        `);
        
        // Insert selected accommodation dates
        // Sort dates to process them in chronological order
        const sortedDates = accommodation_dates.sort();
        const coveredNights = assignment.covered_nights || 0;
        
        for (let i = 0; i < sortedDates.length; i++) {
          const date = sortedDates[i];
          // First N nights are covered, rest are extra
          const isExtraNight = i >= coveredNights;
          
          // For extra nights, we'll need to set pricing (this could be fetched from room_types table)
          // For now, using a default price that should be configured
          const pricePerNight = isExtraNight ? 1950.00 : null; // Default 1950 CZK per extra night
          const paymentStatus = isExtraNight ? 'pending' : 'not_required';
          
          await client.query(
            `INSERT INTO accommodation_selections (invitation_id, selected_date, is_extra_night, price_per_night, currency, payment_status) 
             VALUES ($1, $2::date, $3, $4, $5, $6) 
             ON CONFLICT (invitation_id, selected_date) 
             DO UPDATE SET is_extra_night = $3, price_per_night = $4, payment_status = $6`,
            [assignment.id, date, isExtraNight, pricePerNight, 'CZK', paymentStatus]
          );
        }
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
    // Send confirmation email
    try {
      const emailLanguage = assignment.guest_language || 'english';
      
      // Get confirmation email template for the guest's language
      const templateResult = await pool.query(`
        SELECT * FROM email_templates 
        WHERE edition_id = $1 AND language = $2 AND template_type = 'confirmation'
        ORDER BY created_at DESC
        LIMIT 1
      `, [assignment.edition_id, emailLanguage]);
      
      if (templateResult.rows.length > 0) {
        const template = templateResult.rows[0];
        const confirmedAt = new Date();
        
        // Format accommodation dates for display
        let formattedAccommodationDates = '';
        if (accommodation_dates.length > 0) {
          const dateFormatter = new Intl.DateTimeFormat(emailLanguage === 'czech' ? 'cs-CZ' : 'en-US', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
          });
          formattedAccommodationDates = accommodation_dates.map(date => 
            dateFormatter.format(new Date(date + 'T00:00:00'))
          ).join(', ');
        }
        
        // Prepare template variables
        const templateData = {
          greeting: assignment.greeting || '',
          guest_name: assignment.name,
          edition_name: assignment.edition_name,
          category: assignment.category,
          confirmed_at: confirmedAt.toLocaleString(emailLanguage === 'czech' ? 'cs-CZ' : 'en-US'),
          company: assignment.company || '',
          language: emailLanguage,
          accommodation_dates: formattedAccommodationDates || false, // Use false when no dates
          has_accommodation_dates: accommodation_dates.length > 0
        };
        
        // Process template content and add accommodation info if needed
        let templateContent = template.markdown_content || template.body || '';
        
        // If there are accommodation dates, add them to the template content
        if (accommodation_dates.length > 0) {
          const accommodationSection = emailLanguage === 'czech' 
            ? `- **Ubytování potvrzeno pro:** ${formattedAccommodationDates}`
            : `- **Accommodation confirmed for:** ${formattedAccommodationDates}`;
          
          // Insert accommodation info after the "Confirmed at:" line
          const confirmationLinePattern = emailLanguage === 'czech' 
            ? /(\*\*Potvrzeno:\*\* \{\{confirmed_at\}\})/
            : /(\*\*Confirmed at:\*\* \{\{confirmed_at\}\})/;
          
          templateContent = templateContent.replace(confirmationLinePattern, `$1\n${accommodationSection}`);
        }
        
        const processed = processTemplate(templateContent, templateData, { isPreview: false });
        
        // Replace variables in subject
        let emailSubject = template.subject;
        Object.keys(templateData).forEach(key => {
          const placeholder = `{{${key}}}`;
          emailSubject = emailSubject.replace(new RegExp(placeholder, 'g'), templateData[key] || '');
        });
        
        const emailHtml = processed.html;
        
        // Send the confirmation email with CC to guest@irmf.cz
        const emailData = {
          to: assignment.email,
          cc: 'guest@irmf.cz',
          subject: emailSubject,
          html: emailHtml,
        };
        
        await sendEmail(emailData);
        console.log(`Confirmation email sent to ${assignment.email} for ${assignment.name}`);
      } else {
        console.warn(`No confirmation email template found for language: ${emailLanguage}`);
      }
    } catch (emailError) {
      // Log email error but don't fail the confirmation
      console.error('Failed to send confirmation email:', emailError.message);
      logError(emailError, req, { 
        operation: 'send_confirmation_email', 
        token: req.params.token, 
        email: assignment.email 
      });
    }
    
    res.json({
      message: 'Invitation confirmed successfully',
      guest: assignment.name,
      edition: assignment.edition_name,
      category: assignment.category,
      accommodation_dates: accommodation_dates,
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
        m.image_url,
        e.year as edition_year,
        e.name as edition_name
      FROM movies m
      JOIN editions e ON m.edition_id = e.id
      WHERE m.is_public = true
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
      WHERE m.is_public = true
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
      WHERE ${isUuid ? 'm.id' : 'm.mysql_id'} = $1 AND m.is_public = true
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

// Public programming schedule routes (READ-ONLY)
// GET /api/public/programming - List programming schedule with optional filtering
router.get('/public/programming', async (req, res) => {
  try {
    const { 
      edition_id, 
      venue_id, 
      date,
      limit = 100,
      offset = 0
    } = req.query;

    let query = `
      SELECT 
        ps.id,
        ps.scheduled_date::text as scheduled_date,
        ps.scheduled_time,
        ps.total_runtime,
        ps.title_override_cs,
        ps.title_override_en,
        ps.notes,
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
        m.image_url as movie_image_url,
        -- Block details (if block)
        mb.name_cs as block_name_cs,
        mb.name_en as block_name_en,
        mb.description_cs as block_description_cs,
        mb.description_en as block_description_en,
        e.year as edition_year,
        e.name as edition_name
      FROM programming_schedule ps
      JOIN venues v ON ps.venue_id = v.id
      JOIN editions e ON ps.edition_id = e.id
      LEFT JOIN movies m ON ps.movie_id = m.id
      LEFT JOIN movie_blocks mb ON ps.block_id = mb.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;

    // Add filters
    if (edition_id) {
      params.push(edition_id);
      query += ` AND ps.edition_id = $${++paramCount}`;
    }
    
    if (venue_id) {
      params.push(venue_id);
      query += ` AND ps.venue_id = $${++paramCount}`;
    }
    
    if (date) {
      params.push(date);
      query += ` AND ps.scheduled_date = $${++paramCount}`;
    }

    // Order by date and time
    query += ` ORDER BY ps.scheduled_date, ps.scheduled_time, v.sort_order`;

    // Add pagination
    params.push(limit);
    query += ` LIMIT $${++paramCount}`;
    params.push(offset);
    query += ` OFFSET $${++paramCount}`;

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM programming_schedule ps
      WHERE 1=1
    `;
    
    if (edition_id) countQuery += ` AND ps.edition_id = '${edition_id}'`;
    if (venue_id) countQuery += ` AND ps.venue_id = '${venue_id}'`;
    if (date) countQuery += ` AND ps.scheduled_date = '${date}'`;
    
    const countResult = await pool.query(countQuery);
    const total = parseInt(countResult.rows[0].total);

    // Add image URLs to movies
    const programmingWithImages = result.rows.map(entry => {
      if (entry.movie_image_url) {
        entry.movie_image_urls = {
          original: imageStorage.getImageUrl(entry.movie_image_url, 'original'),
          large: imageStorage.getImageUrl(entry.movie_image_url, 'large'),
          medium: imageStorage.getImageUrl(entry.movie_image_url, 'medium'),
          thumbnail: imageStorage.getImageUrl(entry.movie_image_url, 'thumbnail'),
          small: imageStorage.getImageUrl(entry.movie_image_url, 'small')
        };
      }
      return entry;
    });

    res.json({
      programming: programmingWithImages,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logError(error, req, { operation: 'list_public_programming' });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/public/programming/:id - Get specific programming entry details
router.get('/public/programming/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT 
        ps.id,
        ps.scheduled_date::text as scheduled_date,
        ps.scheduled_time,
        ps.base_runtime,
        ps.discussion_time,
        ps.total_runtime,
        ps.title_override_cs,
        ps.title_override_en,
        ps.notes,
        v.name_cs as venue_name_cs,
        v.name_en as venue_name_en,
        v.capacity as venue_capacity,
        -- Movie details (if single movie)
        m.id as movie_id,
        m.name_cs as movie_name_cs,
        m.name_en as movie_name_en,
        m.director as movie_director,
        m.runtime as movie_runtime,
        m.section as movie_section,
        m.synopsis_cs as movie_synopsis_cs,
        m.synopsis_en as movie_synopsis_en,
        m.year as movie_year,
        m.country as movie_country,
        m.cast as movie_cast,
        m.image_url as movie_image_url,
        -- Block details (if block)
        mb.id as block_id,
        mb.name_cs as block_name_cs,
        mb.name_en as block_name_en,
        mb.description_cs as block_description_cs,
        mb.description_en as block_description_en,
        e.year as edition_year,
        e.name as edition_name
      FROM programming_schedule ps
      JOIN venues v ON ps.venue_id = v.id
      JOIN editions e ON ps.edition_id = e.id
      LEFT JOIN movies m ON ps.movie_id = m.id
      LEFT JOIN movie_blocks mb ON ps.block_id = mb.id
      WHERE ps.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Programming entry not found' });
    }
    
    const entry = result.rows[0];
    
    // If it's a block, get the movies in the block
    if (entry.block_id) {
      const moviesResult = await pool.query(`
        SELECT 
          m.id,
          m.name_cs,
          m.name_en,
          m.director,
          m.runtime,
          m.section,
          m.synopsis_cs,
          m.synopsis_en,
          m.year,
          m.country,
          m.cast,
          m.image_url,
          bm.sort_order
        FROM block_movies bm
        JOIN movies m ON bm.movie_id = m.id
        WHERE bm.block_id = $1
        ORDER BY bm.sort_order, m.name_cs
      `, [entry.block_id]);
      
      // Add image URLs to block movies
      entry.block_movies = moviesResult.rows.map(movie => {
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
    }
    
    // Add image URLs to single movie if present
    if (entry.movie_image_url) {
      entry.movie_image_urls = {
        original: imageStorage.getImageUrl(entry.movie_image_url, 'original'),
        large: imageStorage.getImageUrl(entry.movie_image_url, 'large'),
        medium: imageStorage.getImageUrl(entry.movie_image_url, 'medium'),
        thumbnail: imageStorage.getImageUrl(entry.movie_image_url, 'thumbnail'),
        small: imageStorage.getImageUrl(entry.movie_image_url, 'small')
      };
    }
    
    res.json({
      programming: entry
    });

  } catch (error) {
    logError(error, req, { operation: 'get_public_programming', programmingId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/accommodation-options/:token - Get available accommodation for invitation
router.get('/accommodation-options/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // First verify the invitation exists and get edition info
    const invitationResult = await pool.query(`
      SELECT gi.*, e.id as edition_id, e.start_date, e.end_date
      FROM guest_invitations gi
      JOIN editions e ON gi.edition_id = e.id
      WHERE gi.token = $1 AND gi.confirmed_at IS NULL
    `, [token]);
    
    if (invitationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or already used confirmation token' });
    }
    
    const invitation = invitationResult.rows[0];
    
    // Get available accommodation options for this edition
    const accommodationResult = await pool.query(`
      SELECT 
        h.id as hotel_id,
        h.name as hotel_name,
        h.description as hotel_description,
        rt.id as room_type_id,
        rt.name as room_type_name,
        rt.description as room_type_description,
        rt.capacity,
        rt.price_per_night,
        rt.currency,
        rt.amenities,
        ra.available_date,
        ra.available_rooms,
        ra.total_rooms
      FROM hotels h
      JOIN room_types rt ON h.id = rt.hotel_id
      JOIN room_availability ra ON rt.id = ra.room_type_id
      WHERE h.edition_id = $1 
        AND h.active = true 
        AND rt.active = true
        AND ra.available_rooms > 0
        AND ra.available_date >= $2 
        AND ra.available_date <= $3
      ORDER BY h.sort_order, h.name, rt.sort_order, rt.name, ra.available_date
    `, [invitation.edition_id, invitation.start_date, invitation.end_date]);
    
    // Group by hotel and room type
    const accommodationOptions = {};
    
    accommodationResult.rows.forEach(row => {
      const hotelKey = row.hotel_id;
      const roomTypeKey = row.room_type_id;
      
      if (!accommodationOptions[hotelKey]) {
        accommodationOptions[hotelKey] = {
          hotel_id: row.hotel_id,
          hotel_name: row.hotel_name,
          hotel_description: row.hotel_description,
          room_types: {}
        };
      }
      
      if (!accommodationOptions[hotelKey].room_types[roomTypeKey]) {
        accommodationOptions[hotelKey].room_types[roomTypeKey] = {
          room_type_id: row.room_type_id,
          room_type_name: row.room_type_name,
          room_type_description: row.room_type_description,
          capacity: row.capacity,
          price_per_night: row.price_per_night,
          currency: row.currency,
          amenities: row.amenities,
          available_dates: []
        };
      }
      
      accommodationOptions[hotelKey].room_types[roomTypeKey].available_dates.push({
        date: row.available_date,
        available_rooms: row.available_rooms,
        total_rooms: row.total_rooms
      });
    });
    
    // Convert to array format
    const hotels = Object.values(accommodationOptions).map(hotel => ({
      ...hotel,
      room_types: Object.values(hotel.room_types)
    }));
    
    res.json({
      hotels,
      edition_dates: {
        start_date: invitation.start_date,
        end_date: invitation.end_date
      }
    });
    
  } catch (error) {
    logError(error, req, { operation: 'get_accommodation_options', token: req.params.token });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/public/venues - List available venues
router.get('/public/venues', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        name_cs,
        name_en,
        capacity,
        sort_order
      FROM venues 
      WHERE active = true
      ORDER BY sort_order
    `);
    
    res.json({
      venues: result.rows
    });

  } catch (error) {
    logError(error, req, { operation: 'list_public_venues' });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;