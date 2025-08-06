const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const mailgunService = require('../utils/mailgun');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware, captureOriginalData } = require('../utils/auditLogger');
const { processTemplate } = require('../utils/templateEngine');
const router = express.Router();

// Apply audit middleware to all routes
// Note: captureOriginalData must come before auditMiddleware
router.use(captureOriginalData('invitations'));
router.use(auditMiddleware('invitations'));

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
    
    // Get email template for the specified language
    const templateResult = await pool.query(`
      SELECT * FROM email_templates 
      WHERE language = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [emailLanguage]);
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ 
        error: `Email template not found for language: ${emailLanguage}` 
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
    
    // Get email template for the specified language
    const templateResult = await pool.query(`
      SELECT * FROM email_templates 
      WHERE language = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [emailLanguage]);
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ 
        error: `Email template not found for language: ${emailLanguage}` 
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
        gi.invited_at as sent_at,
        gi.confirmed_at as responded_at,
        gi.accommodation,
        gi.covered_nights,
        gi.badge_printed_at,
        CASE 
          WHEN gi.badge_printed_at IS NOT NULL THEN 'badge_printed'
          WHEN gi.confirmed_at IS NOT NULL THEN 'confirmed'
          ELSE 'sent'
        END as status,
        NULL as opened_at,
        g.first_name,
        g.last_name,
        g.email,
        g.company,
        g.photo,
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
          (SELECT ARRAY_AGG(TO_CHAR(acs.selected_date, 'YYYY-MM-DD') ORDER BY acs.selected_date)
           FROM accommodation_selections acs 
           WHERE acs.invitation_id = gi.id),
          ARRAY[]::text[]
        ) as accommodation_dates
      FROM guest_invitations gi
      JOIN guests g ON gi.guest_id = g.id
      JOIN editions e ON gi.edition_id = e.id
      WHERE gi.edition_id = $1
      ORDER BY gi.invited_at DESC
    `, [editionId]);
    
    // Transform data to match frontend expectations
    const invitations = result.rows.map(row => ({
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
      guest: {
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        company: row.company,
        photo: row.photo,
        category: row.category
      },
      edition: {
        name: row.edition_name,
        year: row.edition_year
      }
    }));
    
    res.json({ data: invitations });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({ error: error.message });
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
        ) as category
      FROM guests g
      JOIN guest_tags gt ON g.id = gt.guest_id
      JOIN tags year_tag ON gt.tag_id = year_tag.id
      JOIN editions e ON year_tag.name = e.year::text
      WHERE e.id = $1
      AND NOT EXISTS (
        SELECT 1 FROM guest_invitations gi 
        WHERE gi.guest_id = g.id AND gi.edition_id = e.id
      )
      ORDER BY g.first_name, g.last_name
    `, [editionId]);
    
    // Transform data to match frontend expectations
    const assignedNotInvited = result.rows.map(row => ({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      company: row.company,
      photo: row.photo,
      language: row.language,
      category: row.category,
      edition: {
        name: row.edition_name,
        year: row.edition_year
      }
    }));
    
    res.json({ data: assignedNotInvited });
  } catch (error) {
    console.error('Error fetching assigned but not invited guests:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete invitation
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

module.exports = router;