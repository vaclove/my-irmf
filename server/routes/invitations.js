const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const mailgunService = require('../utils/mailgun');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware, captureOriginalData } = require('../utils/auditLogger');
const { processTemplate } = require('../utils/templateEngine');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Apply audit middleware to all routes
// Note: captureOriginalData must come before auditMiddleware
router.use(captureOriginalData('invitations'));
router.use(auditMiddleware('invitations'));

// Email transporter setup (fallback for SMTP)
const createTransporter = () => {
  return nodemailer.createTransport({
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
    return await transporter.sendMail(mailOptions);
  } else {
    throw new Error('No email service configured. Please set up Mailgun or SMTP settings.');
  }
};


// Send invitation to guest for specific edition
router.post('/send', async (req, res) => {
  const { guest_id, edition_id, language = 'english', accommodation = false, covered_nights = 0 } = req.body;
  
  try {
    
    if (!guest_id || !edition_id) {
      return res.status(400).json({ error: 'Guest ID and Edition ID are required' });
    }
    
    // Check if guest has the year tag for this edition
    const guestEditionResult = await pool.query(`
      SELECT g.first_name || ' ' || g.last_name as name, 
             g.first_name, g.last_name, g.email, g.language as guest_language, g.company, g.greeting,
             e.name as edition_name, e.year,
             COALESCE(
               (SELECT tag_name FROM (
                 SELECT t2.name as tag_name,
                        CASE t2.name
                          WHEN 'filmmaker' THEN 1
                          WHEN 'press' THEN 2
                          WHEN 'staff' THEN 3
                          WHEN 'guest' THEN 4
                          WHEN 'public' THEN 5
                          ELSE 6
                        END as priority
                 FROM guest_tags gt2
                 JOIN tags t2 ON gt2.tag_id = t2.id
                 WHERE gt2.guest_id = g.id
                 AND t2.name IN ('filmmaker', 'press', 'staff', 'guest', 'public')
                 ORDER BY priority
                 LIMIT 1
               ) sub),
               'guest'
             ) as category
      FROM guests g
      JOIN guest_tags gt ON g.id = gt.guest_id
      JOIN tags year_tag ON gt.tag_id = year_tag.id
      JOIN editions e ON year_tag.name = e.year::text
      WHERE g.id = $1 AND e.id = $2
    `, [guest_id, edition_id]);
    
    if (guestEditionResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Guest is not assigned to this edition. Please assign the year tag to the guest first.' 
      });
    }
    
    const assignment = guestEditionResult.rows[0];
    
    // Use guest's preferred language if not specified
    const emailLanguage = language || assignment.guest_language || 'english';
    
    // Get email template for the specified language (invitation type)
    const templateResult = await pool.query(`
      SELECT * FROM email_templates 
      WHERE language = $1 AND template_type = 'invitation'
      ORDER BY created_at DESC
      LIMIT 1
    `, [emailLanguage]);
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ 
        error: `Invitation email template not found for language: ${emailLanguage}` 
      });
    }
    
    const template = templateResult.rows[0];
    
    // Generate confirmation token
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    const confirmationUrl = `${process.env.APP_URL}/confirm/${confirmationToken}`;
    
    // Prepare template variables
    const templateData = {
      greeting: assignment.greeting || '',
      guest_name: assignment.name,
      edition_name: assignment.edition_name,
      category: assignment.category,
      confirmation_url: confirmationUrl,
      company: assignment.company || '',
      language: emailLanguage,
      has_accommodation: accommodation,
      accommodation_nights: covered_nights
    };
    
    // If template has custom accommodation content, process it only if accommodation is provided
    if (template.accommodation_content && template.accommodation_content.trim() && accommodation && covered_nights > 0) {
      let processedAccommodationContent = template.accommodation_content.trim();
      
      // Add special night text variable with language-aware grammar
      const nights = parseInt(templateData.accommodation_nights) || 0;
      const language = templateData.language || 'english';
      
      let accommodationNightsText = '';
      if (language === 'czech') {
        const nightText = nights === 1 ? 'noc' : (nights >= 2 && nights <= 4 ? 'noci' : 'nocí');
        accommodationNightsText = `${nights} ${nightText}`;
      } else {
        const nightText = nights === 1 ? 'night' : 'nights';
        accommodationNightsText = `${nights} ${nightText}`;
      }
      
      const extendedVariables = {
        ...templateData,
        accommodation_nights_text: accommodationNightsText
      };
      
      // Process template variables within custom accommodation content
      Object.keys(extendedVariables).forEach(key => {
        if (key !== 'accommodation_info') { // Avoid infinite recursion
          const placeholder = `{{${key}}}`;
          const value = extendedVariables[key] || '';
          processedAccommodationContent = processedAccommodationContent.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
        }
      });
      
      templateData.accommodation_info = processedAccommodationContent;
    }
    
    // Process template content using template engine (same as preview)
    const templateContent = template.markdown_content || template.body || '';
    const processed = processTemplate(templateContent, templateData, { isPreview: false });
    
    // Replace variables in subject
    let emailSubject = template.subject;
    Object.keys(templateData).forEach(key => {
      const placeholder = `{{${key}}}`;
      emailSubject = emailSubject.replace(new RegExp(placeholder, 'g'), templateData[key] || '');
    });
    
    const emailHtml = processed.html;
    
    try {
      const emailData = {
        to: assignment.email,
        subject: emailSubject,
        html: emailHtml,
      };
      
      await sendEmail(emailData);
      
      // Insert or update invitation tracking
      await pool.query(
        `INSERT INTO guest_invitations (guest_id, edition_id, template_id, token, invited_at, accommodation, covered_nights)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6)
         ON CONFLICT (guest_id, edition_id, template_id) 
         DO UPDATE SET 
           invited_at = CURRENT_TIMESTAMP,
           token = $4,
           accommodation = $5,
           covered_nights = $6`,
        [guest_id, edition_id, template.id, confirmationToken, accommodation, covered_nights]
      );

      // Assign badge number if guest doesn't have one for this edition
      const badgeNumberResult = await pool.query(`
        SELECT id FROM guest_badge_numbers 
        WHERE guest_id = $1 AND edition_id = $2
      `, [guest_id, edition_id]);
      
      if (badgeNumberResult.rows.length === 0) {
        await pool.query(`
          INSERT INTO guest_badge_numbers (guest_id, edition_id, badge_number)
          VALUES ($1, $2, get_next_badge_number($2))
        `, [guest_id, edition_id]);
      }
      
      res.json({ 
        message: 'Invitation sent successfully',
        invited_at: new Date().toISOString(),
        token: confirmationToken,
        language: emailLanguage,
        accommodation,
        covered_nights
      });
    } catch (emailError) {
      logError(emailError, req, { operation: 'send_invitation_email', guestId: guest_id, editionId: edition_id });
      res.status(500).json({ error: 'Failed to send email: ' + emailError.message });
    }
    
  } catch (error) {
    logError(error, req, { operation: 'send_invitation', guestId: guest_id, editionId: edition_id, formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Resend invitation to guest for specific edition
router.post('/resend', async (req, res) => {
  try {
    const { guest_id, edition_id, invitation_id } = req.body;
    
    // Support both invitation_id and guest_id/edition_id formats
    let guestId = guest_id;
    let editionId = edition_id;
    
    if (invitation_id && !guestId && !editionId) {
      // Get guest_id and edition_id from invitation_id
      const invitationResult = await pool.query(`
        SELECT guest_id, edition_id FROM guest_invitations WHERE id = $1
      `, [invitation_id]);
      
      if (invitationResult.rows.length === 0) {
        return res.status(404).json({ error: 'Invitation not found' });
      }
      
      guestId = invitationResult.rows[0].guest_id;
      editionId = invitationResult.rows[0].edition_id;
    }
    
    if (!guestId || !editionId) {
      return res.status(400).json({ error: 'Guest ID and Edition ID are required' });
    }
    
    // Check if guest has been previously invited
    const invitationResult = await pool.query(`
      SELECT * FROM guest_invitations 
      WHERE guest_id = $1 AND edition_id = $2
    `, [guestId, editionId]);
    
    if (invitationResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'No previous invitation found for this guest and edition' 
      });
    }
    
    const invitation = invitationResult.rows[0];
    
    // Check if guest has the year tag for this edition
    const guestEditionResult = await pool.query(`
      SELECT g.first_name || ' ' || g.last_name as name, 
             g.first_name, g.last_name, g.email, g.language as guest_language, g.company, g.greeting,
             e.name as edition_name, e.year,
             COALESCE(
               (SELECT tag_name FROM (
                 SELECT t2.name as tag_name,
                        CASE t2.name
                          WHEN 'filmmaker' THEN 1
                          WHEN 'press' THEN 2
                          WHEN 'staff' THEN 3
                          WHEN 'guest' THEN 4
                          WHEN 'public' THEN 5
                          ELSE 6
                        END as priority
                 FROM guest_tags gt2
                 JOIN tags t2 ON gt2.tag_id = t2.id
                 WHERE gt2.guest_id = g.id
                 AND t2.name IN ('filmmaker', 'press', 'staff', 'guest', 'public')
                 ORDER BY priority
                 LIMIT 1
               ) sub),
               'guest'
             ) as category
      FROM guests g
      JOIN guest_tags gt ON g.id = gt.guest_id
      JOIN tags year_tag ON gt.tag_id = year_tag.id
      JOIN editions e ON year_tag.name = e.year::text
      WHERE g.id = $1 AND e.id = $2
    `, [guestId, editionId]);
    
    if (guestEditionResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Guest is not assigned to this edition. Please assign the year tag to the guest first.' 
      });
    }
    
    const assignment = guestEditionResult.rows[0];
    
    // Use guest's preferred language from previous invitation or default
    const emailLanguage = assignment.guest_language || 'english';
    
    // Get email template for the specified language (invitation type)
    const templateResult = await pool.query(`
      SELECT * FROM email_templates 
      WHERE language = $1 AND template_type = 'invitation'
      ORDER BY created_at DESC
      LIMIT 1
    `, [emailLanguage]);
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ 
        error: `Invitation email template not found for language: ${emailLanguage}` 
      });
    }
    
    const template = templateResult.rows[0];
    
    // Generate new confirmation token
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    const confirmationUrl = `${process.env.APP_URL}/confirm/${confirmationToken}`;
    
    // Prepare template variables
    const templateData = {
      greeting: assignment.greeting || '',
      guest_name: assignment.name,
      edition_name: assignment.edition_name,
      category: assignment.category,
      confirmation_url: confirmationUrl,
      company: assignment.company || '',
      language: emailLanguage,
      has_accommodation: invitation.accommodation,
      accommodation_nights: invitation.covered_nights
    };
    
    // If template has custom accommodation content, process it only if accommodation is provided
    if (template.accommodation_content && template.accommodation_content.trim() && invitation.accommodation && invitation.covered_nights > 0) {
      let processedAccommodationContent = template.accommodation_content.trim();
      
      // Add special night text variable with language-aware grammar
      const nights = parseInt(templateData.accommodation_nights) || 0;
      const language = templateData.language || 'english';
      
      let accommodationNightsText = '';
      if (language === 'czech') {
        const nightText = nights === 1 ? 'noc' : (nights >= 2 && nights <= 4 ? 'noci' : 'nocí');
        accommodationNightsText = `${nights} ${nightText}`;
      } else {
        const nightText = nights === 1 ? 'night' : 'nights';
        accommodationNightsText = `${nights} ${nightText}`;
      }
      
      const extendedVariables = {
        ...templateData,
        accommodation_nights_text: accommodationNightsText
      };
      
      // Process template variables within custom accommodation content
      Object.keys(extendedVariables).forEach(key => {
        if (key !== 'accommodation_info') { // Avoid infinite recursion
          const placeholder = `{{${key}}}`;
          const value = extendedVariables[key] || '';
          processedAccommodationContent = processedAccommodationContent.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
        }
      });
      
      templateData.accommodation_info = processedAccommodationContent;
    }
    
    // Process template content using template engine (same as preview)
    const templateContent = template.markdown_content || template.body || '';
    const processed = processTemplate(templateContent, templateData, { isPreview: false });
    
    // Replace variables in subject
    let emailSubject = template.subject;
    Object.keys(templateData).forEach(key => {
      const placeholder = `{{${key}}}`;
      emailSubject = emailSubject.replace(new RegExp(placeholder, 'g'), templateData[key] || '');
    });
    
    const emailHtml = processed.html;
    
    try {
      const emailData = {
        to: assignment.email,
        subject: emailSubject,
        html: emailHtml,
      };
      
      await sendEmail(emailData);
      
      // Update invitation with new token and timestamp, clear previous confirmation
      await pool.query(
        `UPDATE guest_invitations 
         SET invited_at = CURRENT_TIMESTAMP,
             token = $3,
             confirmed_at = NULL
         WHERE guest_id = $1 AND edition_id = $2`,
        [guestId, editionId, confirmationToken]
      );
      
      res.json({ 
        message: 'Invitation resent successfully',
        invited_at: new Date().toISOString(),
        token: confirmationToken,
        language: emailLanguage,
        accommodation: invitation.accommodation,
        covered_nights: invitation.covered_nights
      });
    } catch (emailError) {
      logError(emailError, req, { operation: 'resend_invitation_email', guestId: guestId, editionId: editionId });
      res.status(500).json({ error: 'Failed to resend email: ' + emailError.message });
    }
    
  } catch (error) {
    logError(error, req, { operation: 'resend_invitation', guestId: guestId, editionId: editionId, formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Get invitations by edition
router.get('/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        gi.id,
        gi.guest_id,
        gi.edition_id,
        gi.token,
        gi.invited_at,
        gi.sent_at,
        gi.opened_at,
        gi.confirmed_at,
        gi.declined_at,
        COALESCE(gi.confirmed_at, gi.declined_at) AS responded_at,
        gi.accommodation,
        gi.covered_nights,
        gi.badge_printed_at,
        gi.status,
        g.first_name,
        g.last_name,
        g.email,
        g.company,
        g.photo,
        g.image_path,
        g.language,
        g.greeting,
        e.name as edition_name,
        e.year as edition_year,
        COALESCE(ge.category, 'guest') as category,
        COALESCE(
          (SELECT ARRAY_AGG(TO_CHAR(acs.selected_date, 'YYYY-MM-DD') ORDER BY acs.selected_date)
           FROM accommodation_selections acs 
           WHERE acs.invitation_id = gi.id),
          ARRAY[]::text[]
        ) as accommodation_dates,
        COALESCE(
          (SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'primary_guest_id', gr.primary_guest_id,
              'primary_guest_name', pg.first_name || ' ' || pg.last_name,
              'relationship_type', gr.relationship_type,
              'edition_id', gr.edition_id,
              'edition_year', re.year
            )
          )
          FROM guest_relationships gr
          JOIN guests pg ON gr.primary_guest_id = pg.id
          JOIN editions re ON gr.edition_id = re.id
          WHERE gr.related_guest_id = g.id),
          '[]'::json
        ) as secondary_relationships
      FROM guest_invitations gi
      JOIN guests g ON gi.guest_id = g.id
      JOIN editions e ON gi.edition_id = e.id
      LEFT JOIN guest_editions ge ON gi.guest_id = ge.guest_id AND gi.edition_id = ge.edition_id
      WHERE gi.edition_id = $1
      ORDER BY gi.invited_at DESC
    `, [editionId]);
    
    // Transform data to match frontend expectations
    const invitations = result.rows.map(row => {
      // Prepare guest object with S3 image URLs
      const guest = {
        id: row.guest_id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        company: row.company,
        language: row.language,
        greeting: row.greeting,
        category: row.category,
        secondary_relationships: row.secondary_relationships || []
      };
      
      // Add S3 image URLs if the guest has migrated images
      if (row.image_path) {
        const guestImageStorage = require('../services/guestImageStorage');
        guest.image_urls = {
          thumbnail: guestImageStorage.getImageUrl(row.image_path, 'thumbnail'),
          medium: guestImageStorage.getImageUrl(row.image_path, 'medium'),
          original: guestImageStorage.getImageUrl(row.image_path, 'original')
        };
      }
      
      return {
        id: row.id,
        guest_id: row.guest_id,
        edition_id: row.edition_id,
        token: row.token,
        sent_at: row.sent_at,
        opened_at: row.opened_at,
        responded_at: row.responded_at,
        badge_printed_at: row.badge_printed_at,
        status: row.status,
        accommodation: row.accommodation,
        covered_nights: row.covered_nights,
        accommodation_dates: row.accommodation_dates || [],
        guest: guest,
        edition: {
          name: row.edition_name,
          year: row.edition_year
        }
      };
    });
    
    res.json({ data: invitations });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update accommodation dates for an invitation
router.put('/:invitationId/accommodation-dates', async (req, res) => {
  const client = await pool.connect();
  try {
    const { invitationId } = req.params;
    const { accommodation_dates } = req.body;

    if (!accommodation_dates || !Array.isArray(accommodation_dates)) {
      return res.status(400).json({ error: 'accommodation_dates array is required' });
    }

    await client.query('BEGIN');

    // Check if invitation exists
    const invitationResult = await client.query(
      'SELECT id, accommodation, covered_nights FROM guest_invitations WHERE id = $1',
      [invitationId]
    );

    if (invitationResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invitation not found' });
    }

    const invitation = invitationResult.rows[0];
    
    // Check if invitation has accommodation
    if (!invitation.accommodation) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This invitation does not include accommodation' });
    }

    // Delete existing accommodation selections
    await client.query(
      'DELETE FROM accommodation_selections WHERE invitation_id = $1',
      [invitationId]
    );

    // Insert new accommodation dates with extra nights logic
    // Sort dates to process them in chronological order
    const sortedDates = accommodation_dates.sort();
    const coveredNights = invitation.covered_nights || 0;
    
    for (let i = 0; i < sortedDates.length; i++) {
      const date = sortedDates[i];
      // First N nights are covered, rest are extra
      const isExtraNight = i >= coveredNights;
      const pricePerNight = isExtraNight ? 1950.00 : null;
      const paymentStatus = isExtraNight ? 'pending' : 'not_required';
      
      await client.query(
        `INSERT INTO accommodation_selections 
         (invitation_id, selected_date, is_extra_night, price_per_night, currency, payment_status) 
         VALUES ($1, $2::date, $3, $4, $5, $6)`,
        [invitationId, date, isExtraNight, pricePerNight, 'CZK', paymentStatus]
      );
    }

    // Update the invitation's extra nights count and status if there are extra nights
    const extraNights = Math.max(0, sortedDates.length - coveredNights);
    if (extraNights > 0) {
      await client.query(
        `UPDATE guest_invitations 
         SET requested_extra_nights = $1, 
             extra_nights_status = CASE 
               WHEN extra_nights_status = 'not_requested' THEN 'approved' 
               ELSE extra_nights_status 
             END
         WHERE id = $2`,
        [extraNights, invitationId]
      );
    } else {
      // If no extra nights, reset the extra nights fields
      await client.query(
        `UPDATE guest_invitations 
         SET requested_extra_nights = 0, 
             extra_nights_status = 'not_requested' 
         WHERE id = $1`,
        [invitationId]
      );
    }

    // If guest didn't have accommodation before but now has dates, update the accommodation flag
    if (!invitation.accommodation && accommodation_dates.length > 0) {
      await client.query(
        'UPDATE guest_invitations SET accommodation = true, covered_nights = $1 WHERE id = $2',
        [accommodation_dates.length, invitationId]
      );
    }

    await client.query('COMMIT');

    res.json({ 
      message: 'Accommodation dates updated successfully',
      accommodation_dates 
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logError(error, req, { operation: 'update_accommodation_dates', invitationId: req.params.invitationId });
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Get guests assigned to edition but not invited
router.get('/edition/:editionId/assigned-not-invited', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        g.id,
        g.first_name,
        g.last_name,
        g.email,
        g.company,
        g.photo,
        g.image_path,
        g.language,
        e.name as edition_name,
        e.year as edition_year,
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
        COALESCE(
          (SELECT JSON_AGG(
            JSON_BUILD_OBJECT(
              'primary_guest_id', gr.primary_guest_id,
              'primary_guest_name', pg.first_name || ' ' || pg.last_name,
              'relationship_type', gr.relationship_type,
              'edition_id', gr.edition_id,
              'edition_year', re.year
            )
          )
          FROM guest_relationships gr
          JOIN guests pg ON gr.primary_guest_id = pg.id
          JOIN editions re ON gr.edition_id = re.id
          WHERE gr.related_guest_id = g.id),
          '[]'::json
        ) as secondary_relationships
      FROM guests g
      JOIN guest_tags gt ON g.id = gt.guest_id
      JOIN tags year_tag ON gt.tag_id = year_tag.id
      JOIN editions e ON year_tag.name = e.year::text
      WHERE e.id = $1
      AND NOT EXISTS (
        SELECT 1 FROM guest_invitations gi 
        WHERE gi.guest_id = g.id AND gi.edition_id = e.id
      )
      ORDER BY g.last_name, g.first_name
    `, [editionId]);
    
    // Transform data to match frontend expectations
    const assignedNotInvited = result.rows.map(row => {
      const guest = {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        company: row.company,
        photo: row.photo,
        language: row.language,
        category: row.category,
        secondary_relationships: row.secondary_relationships || [],
        edition: {
          name: row.edition_name,
          year: row.edition_year
        }
      };
      
      // Add S3 image URLs if the guest has migrated images
      if (row.image_path) {
        const guestImageStorage = require('../services/guestImageStorage');
        guest.image_urls = {
          thumbnail: guestImageStorage.getImageUrl(row.image_path, 'thumbnail'),
          medium: guestImageStorage.getImageUrl(row.image_path, 'medium'),
          original: guestImageStorage.getImageUrl(row.image_path, 'original')
        };
      }
      
      return guest;
    });
    
    res.json({ data: assignedNotInvited });
  } catch (error) {
    console.error('Error fetching assigned but not invited guests:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete invitation
// Update invitation status manually
router.put('/:invitationId/status', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { invitationId } = req.params;
    const { status, is_manual_change = true } = req.body;
    
    // Validate status
    const validStatuses = ['pending', 'opened', 'confirmed', 'declined', 'badge_printed'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status. Must be one of: ' + validStatuses.join(', ') 
      });
    }
    
    await client.query('BEGIN');
    
    // Check if invitation exists
    const invitationResult = await client.query(
      'SELECT id, status FROM guest_invitations WHERE id = $1',
      [invitationId]
    );
    
    if (invitationResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    const currentStatus = invitationResult.rows[0].status;
    
    // Get the user email from the authenticated session
    const changedBy = req.user ? req.user.email : null;
    
    // Update the status and set appropriate timestamps
    let updateQuery = 'UPDATE guest_invitations SET status = $1, is_manual_change = $2, changed_by = $3';
    const updateParams = [status, is_manual_change, changedBy];
    
    // Set or clear timestamps based on status change
    // Clear timestamps when rolling back to an earlier status
    if (status === 'pending') {
      // Rolling back to pending clears all timestamps
      updateQuery += ', opened_at = NULL, confirmed_at = NULL, declined_at = NULL, badge_printed_at = NULL';
    } else if (status === 'opened') {
      // Set opened timestamp and clear later ones
      if (currentStatus === 'pending') {
        updateQuery += ', opened_at = CURRENT_TIMESTAMP';
      }
      updateQuery += ', confirmed_at = NULL, declined_at = NULL, badge_printed_at = NULL';
    } else if (status === 'confirmed') {
      // Set confirmed timestamp and clear declined/badge_printed
      if (currentStatus !== 'confirmed') {
        updateQuery += ', confirmed_at = CURRENT_TIMESTAMP';
      }
      updateQuery += ', declined_at = NULL, badge_printed_at = NULL';
    } else if (status === 'declined') {
      // Set declined timestamp and clear confirmed/badge_printed
      if (currentStatus !== 'declined') {
        updateQuery += ', declined_at = CURRENT_TIMESTAMP';
      }
      updateQuery += ', confirmed_at = NULL, badge_printed_at = NULL';
    } else if (status === 'badge_printed') {
      // Badge printed is the final state, only set if not already set
      if (currentStatus !== 'badge_printed') {
        updateQuery += ', badge_printed_at = CURRENT_TIMESTAMP';
      }
    }
    
    updateQuery += ' WHERE id = $4 RETURNING *';
    updateParams.push(invitationId);
    
    const result = await client.query(updateQuery, updateParams);
    
    await client.query('COMMIT');
    
    res.json({ 
      message: 'Invitation status updated successfully',
      invitation: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating invitation status:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.delete('/:invitationId', async (req, res) => {
  try {
    const { invitationId } = req.params;
    
    const result = await pool.query(`
      DELETE FROM guest_invitations WHERE id = $1 RETURNING *
    `, [invitationId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    res.json({ message: 'Invitation deleted successfully' });
  } catch (error) {
    console.error('Error deleting invitation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send mass email to selected invitations
router.post('/mass-email', async (req, res) => {
  try {
    const { invitation_ids, subjects, contents } = req.body;
    
    if (!invitation_ids || !Array.isArray(invitation_ids) || invitation_ids.length === 0) {
      return res.status(400).json({ error: 'invitation_ids array is required' });
    }
    
    if (!subjects || !contents) {
      return res.status(400).json({ error: 'subjects and contents are required' });
    }
    
    // Get all invitations with guest details
    const invitationsResult = await pool.query(`
      SELECT gi.id, gi.guest_id, gi.edition_id,
             g.first_name, g.last_name, g.email, g.language, g.greeting, g.company,
             e.name as edition_name, e.year as edition_year,
             COALESCE(
               (SELECT tag_name FROM (
                 SELECT t2.name as tag_name,
                        CASE t2.name
                          WHEN 'filmmaker' THEN 1
                          WHEN 'press' THEN 2
                          WHEN 'staff' THEN 3
                          WHEN 'guest' THEN 4
                          WHEN 'public' THEN 5
                          ELSE 6
                        END as priority
                 FROM guest_tags gt2
                 JOIN tags t2 ON gt2.tag_id = t2.id
                 WHERE gt2.guest_id = g.id
                 AND t2.name IN ('filmmaker', 'press', 'staff', 'guest', 'public')
                 ORDER BY priority
                 LIMIT 1
               ) sub),
               'guest'
             ) as category
      FROM guest_invitations gi
      JOIN guests g ON gi.guest_id = g.id
      JOIN editions e ON gi.edition_id = e.id
      WHERE gi.id = ANY($1)
    `, [invitation_ids]);
    
    if (invitationsResult.rows.length === 0) {
      return res.status(404).json({ error: 'No invitations found for the provided IDs' });
    }
    
    const invitations = invitationsResult.rows;
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Send emails to each invitation
    for (const invitation of invitations) {
      try {
        const guestLanguage = invitation.language || 'english';
        const subject = subjects[guestLanguage];
        const content = contents[guestLanguage];
        
        if (!subject || !content) {
          errors.push(`Missing ${guestLanguage} version for ${invitation.first_name} ${invitation.last_name}`);
          errorCount++;
          continue;
        }
        
        // Simple HTML formatting for the email content
        const emailHtml = content.replace(/\n/g, '<br>');
        
        const emailData = {
          to: invitation.email,
          subject: subject,
          html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="margin-bottom: 20px;">
              ${invitation.greeting ? `<p>${invitation.greeting}</p>` : ''}
              ${emailHtml}
            </div>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
            <div style="color: #666; font-size: 12px;">
              <p>This email was sent to: ${invitation.first_name} ${invitation.last_name}</p>
              <p>Event: ${invitation.edition_name}</p>
              <p>Category: ${invitation.category}</p>
            </div>
          </div>`,
        };
        
        await sendEmail(emailData);
        successCount++;
        
      } catch (emailError) {
        console.error(`Error sending email to ${invitation.email}:`, emailError.message);
        errors.push(`Failed to send to ${invitation.first_name} ${invitation.last_name}: ${emailError.message}`);
        errorCount++;
      }
    }
    
    res.json({
      message: `Mass email completed`,
      success_count: successCount,
      error_count: errorCount,
      total: invitations.length,
      errors: errors
    });
    
  } catch (error) {
    logError(error, req, { operation: 'send_mass_email', formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/invitations/extra-nights - Get all extra nights requests
router.get('/extra-nights', async (req, res) => {
  try {
    const { status = 'pending_approval', edition_id } = req.query;
    
    let query = `
      SELECT 
        gi.id,
        gi.token,
        gi.requested_extra_nights,
        gi.extra_nights_comment,
        gi.extra_nights_status,
        gi.extra_nights_approved_by,
        gi.extra_nights_approved_at,
        gi.covered_nights,
        g.first_name || ' ' || g.last_name as guest_name,
        g.email,
        e.name as edition_name,
        e.id as edition_id,
        (
          SELECT json_agg(
            json_build_object(
              'date', as_sel.selected_date,
              'is_extra_night', as_sel.is_extra_night,
              'price_per_night', as_sel.price_per_night
            ) ORDER BY as_sel.selected_date
          )
          FROM accommodation_selections as_sel 
          WHERE as_sel.invitation_id = gi.id
        ) as accommodation_dates
      FROM guest_invitations gi
      JOIN guests g ON gi.guest_id = g.id
      JOIN editions e ON gi.edition_id = e.id
      WHERE gi.requested_extra_nights > 0
    `;
    
    const params = [];
    
    if (status && status !== 'all') {
      query += ` AND gi.extra_nights_status = $${params.length + 1}`;
      params.push(status);
    }
    
    if (edition_id) {
      query += ` AND gi.edition_id = $${params.length + 1}`;
      params.push(edition_id);
    }
    
    query += ' ORDER BY gi.created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_extra_nights_requests' });
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/invitations/:invitationId/extra-nights - Approve or reject extra nights request
router.put('/:invitationId/extra-nights', async (req, res) => {
  try {
    const { invitationId } = req.params;
    const { status, admin_comment = '' } = req.body; // status: 'approved' or 'rejected'
    
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "approved" or "rejected"' });
    }
    
    // Update the extra nights status
    const result = await pool.query(`
      UPDATE guest_invitations 
      SET 
        extra_nights_status = $1,
        extra_nights_approved_by = $2,
        extra_nights_approved_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [status, req.user?.email || 'admin', invitationId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    // If approved, update accommodation_selections to mark extra nights as approved
    if (status === 'approved') {
      await pool.query(`
        UPDATE accommodation_selections 
        SET payment_status = 'pending'
        WHERE invitation_id = $1 AND is_extra_night = true
      `, [invitationId]);
    } else {
      // If rejected, remove extra nights from accommodation_selections
      await pool.query(`
        DELETE FROM accommodation_selections 
        WHERE invitation_id = $1 AND is_extra_night = true
      `, [invitationId]);
    }
    
    res.json({ 
      message: `Extra nights request ${status}`, 
      invitation: result.rows[0] 
    });
  } catch (error) {
    logError(error, req, { operation: 'update_extra_nights_status', invitationId: req.params.invitationId });
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/invitations/:invitationId/covered-nights - Update covered nights for an invitation
router.put('/:invitationId/covered-nights', async (req, res) => {
  try {
    const { invitationId } = req.params;
    const { covered_nights } = req.body;
    
    if (covered_nights === undefined || covered_nights < 0 || covered_nights > 10) {
      return res.status(400).json({ error: 'covered_nights must be a number between 0 and 10' });
    }
    
    // Update the covered nights
    const result = await pool.query(`
      UPDATE guest_invitations 
      SET covered_nights = $1
      WHERE id = $2
      RETURNING *
    `, [covered_nights, invitationId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    res.json({ 
      message: 'Covered nights updated successfully', 
      invitation: result.rows[0] 
    });
  } catch (error) {
    logError(error, req, { operation: 'update_covered_nights', invitationId: req.params.invitationId });
    res.status(500).json({ error: error.message });
  }
});

// Mark guest as invited without sending email
router.post('/mark-as-invited', async (req, res) => {
  const { guest_id, edition_id, accommodation = false, covered_nights = 0 } = req.body;
  
  try {
    if (!guest_id || !edition_id) {
      return res.status(400).json({ error: 'Guest ID and Edition ID are required' });
    }
    
    // Check if guest has the year tag for this edition
    const guestEditionResult = await pool.query(`
      SELECT g.first_name || ' ' || g.last_name as name, 
             g.first_name, g.last_name, g.email, g.language as guest_language,
             e.name as edition_name, e.year,
             COALESCE(
               (SELECT tag_name FROM (
                 SELECT t2.name as tag_name,
                        CASE t2.name
                          WHEN 'filmmaker' THEN 1
                          WHEN 'press' THEN 2
                          WHEN 'staff' THEN 3
                          WHEN 'guest' THEN 4
                          WHEN 'public' THEN 5
                          ELSE 6
                        END as priority
                 FROM guest_tags gt2
                 JOIN tags t2 ON gt2.tag_id = t2.id
                 WHERE gt2.guest_id = g.id
                 AND t2.name IN ('filmmaker', 'press', 'staff', 'guest', 'public')
                 ORDER BY priority
                 LIMIT 1
               ) sub),
               'guest'
             ) as category
      FROM guests g
      JOIN guest_tags gt ON g.id = gt.guest_id
      JOIN tags year_tag ON gt.tag_id = year_tag.id
      JOIN editions e ON year_tag.name = e.year::text
      WHERE g.id = $1 AND e.id = $2
    `, [guest_id, edition_id]);
    
    if (guestEditionResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Guest is not assigned to this edition. Please assign the year tag to the guest first.' 
      });
    }
    
    const assignment = guestEditionResult.rows[0];
    
    // Generate a confirmation token for tracking purposes
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    
    // Get default template ID for tracking
    const templateResult = await pool.query(`
      SELECT id FROM email_templates 
      WHERE template_type = 'invitation'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    const templateId = templateResult.rows.length > 0 ? templateResult.rows[0].id : null;
    
    // Insert or update guest_editions record with category
    await pool.query(
      `INSERT INTO guest_editions (guest_id, edition_id, category, invited_at, accommodation, covered_nights)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5)
       ON CONFLICT (guest_id, edition_id)
       DO UPDATE SET
         invited_at = CURRENT_TIMESTAMP,
         accommodation = $4,
         covered_nights = $5`,
      [guest_id, edition_id, assignment.category, accommodation, covered_nights]
    );

    // Insert or update invitation tracking (mark as manually invited)
    await pool.query(
      `INSERT INTO guest_invitations (guest_id, edition_id, template_id, token, invited_at, accommodation, covered_nights, manual_invitation)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, true)
       ON CONFLICT (guest_id, edition_id, template_id)
       DO UPDATE SET
         invited_at = CURRENT_TIMESTAMP,
         token = $4,
         accommodation = $5,
         covered_nights = $6,
         manual_invitation = true`,
      [guest_id, edition_id, templateId, confirmationToken, accommodation, covered_nights]
    );

    // Assign badge number if guest doesn't have one for this edition
    const badgeNumberResult = await pool.query(`
      SELECT id FROM guest_badge_numbers 
      WHERE guest_id = $1 AND edition_id = $2
    `, [guest_id, edition_id]);
    
    if (badgeNumberResult.rows.length === 0) {
      await pool.query(`
        INSERT INTO guest_badge_numbers (guest_id, edition_id, badge_number)
        VALUES ($1, $2, get_next_badge_number($2))
      `, [guest_id, edition_id]);
    }
    
    res.json({ 
      message: 'Guest marked as invited successfully',
      invited_at: new Date().toISOString(),
      token: confirmationToken,
      accommodation,
      covered_nights,
      manual_invitation: true
    });
    
  } catch (error) {
    logError(error, req, { operation: 'mark_as_invited', guestId: guest_id, editionId: edition_id, formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;