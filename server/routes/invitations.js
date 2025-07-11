const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const mailgunService = require('../utils/mailgun');
const { pool } = require('../models/database');
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
    return await transporter.sendMail(mailOptions);
  } else {
    throw new Error('No email service configured. Please set up Mailgun or SMTP settings.');
  }
};

// Helper function to generate accommodation info
function getAccommodationInfo(language, hasAccommodation, nights) {
  if (!hasAccommodation || nights <= 0) {
    return '';
  }
  
  const accommodationText = {
    english: {
      single: `<div style="background: #e6f7ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1890ff;">
        <p style="margin: 0; font-size: 16px; color: #1890ff;">
          <strong>🏨 Accommodation Included</strong><br>
          We have arranged accommodation for you for <strong>1 night</strong> during the festival.
        </p>
      </div>`,
      multiple: `<div style="background: #e6f7ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1890ff;">
        <p style="margin: 0; font-size: 16px; color: #1890ff;">
          <strong>🏨 Accommodation Included</strong><br>
          We have arranged accommodation for you for <strong>${nights} nights</strong> during the festival.
        </p>
      </div>`
    },
    czech: {
      single: `<div style="background: #e6f7ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1890ff;">
        <p style="margin: 0; font-size: 16px; color: #1890ff;">
          <strong>🏨 Ubytování zahrnuto</strong><br>
          Zajistili jsme pro Vás ubytování na <strong>1 noc</strong> během festivalu.
        </p>
      </div>`,
      multiple: `<div style="background: #e6f7ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1890ff;">
        <p style="margin: 0; font-size: 16px; color: #1890ff;">
          <strong>🏨 Ubytování zahrnuto</strong><br>
          Zajistili jsme pro Vás ubytování na <strong>${nights} nocí</strong> během festivalu.
        </p>
      </div>`
    }
  };
  
  return nights === 1 
    ? accommodationText[language].single 
    : accommodationText[language].multiple;
}

// Send invitation to guest for specific edition
router.post('/send', async (req, res) => {
  try {
    const { guest_id, edition_id, language = 'english', accommodation = false, covered_nights = 0 } = req.body;
    
    if (!guest_id || !edition_id) {
      return res.status(400).json({ error: 'Guest ID and Edition ID are required' });
    }
    
    // Check if assignment exists and get guest/edition info
    const assignmentResult = await pool.query(`
      SELECT ge.*, g.name, g.email, g.language as guest_language, g.company, 
             e.name as edition_name, e.year
      FROM guest_editions ge
      JOIN guests g ON ge.guest_id = g.id
      JOIN editions e ON ge.edition_id = e.id
      WHERE ge.guest_id = $1 AND ge.edition_id = $2
    `, [guest_id, edition_id]);
    
    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Guest assignment not found' });
    }
    
    const assignment = assignmentResult.rows[0];
    
    // Use guest's preferred language if not specified
    const emailLanguage = language || assignment.guest_language || 'english';
    
    // Get email template for the specified language
    const templateResult = await pool.query(`
      SELECT * FROM email_templates 
      WHERE edition_id = $1 AND language = $2
    `, [edition_id, emailLanguage]);
    
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
      guest_name: assignment.name,
      edition_name: assignment.edition_name,
      category: assignment.category,
      confirmation_url: confirmationUrl,
      accommodation_info: getAccommodationInfo(emailLanguage, accommodation, covered_nights),
      company: assignment.company || ''
    };
    
    // Replace template variables
    let emailSubject = template.subject;
    let emailHtml = template.html_content;
    
    Object.keys(templateData).forEach(key => {
      const placeholder = `{{${key}}}`;
      const value = templateData[key];
      
      // For accommodation_info, if empty, remove the entire line/section
      if (key === 'accommodation_info' && (!value || value.trim() === '')) {
        // Remove the placeholder and any surrounding whitespace/newlines
        emailSubject = emailSubject.replace(new RegExp(`\\s*${placeholder}\\s*`, 'g'), '');
        emailHtml = emailHtml.replace(new RegExp(`\\s*${placeholder}\\s*`, 'g'), '');
      } else {
        // Normal replacement for other variables
        emailSubject = emailSubject.replace(new RegExp(placeholder, 'g'), value);
        emailHtml = emailHtml.replace(new RegExp(placeholder, 'g'), value);
      }
    });
    
    try {
      const emailData = {
        to: assignment.email,
        subject: emailSubject,
        html: emailHtml,
      };
      
      await sendEmail(emailData);
      
      // Update database with invitation details including accommodation
      await pool.query(
        `UPDATE guest_editions SET 
         invited_at = CURRENT_TIMESTAMP, 
         confirmation_token = $1,
         accommodation = $2,
         covered_nights = $3
         WHERE guest_id = $4 AND edition_id = $5`,
        [confirmationToken, accommodation, covered_nights, guest_id, edition_id]
      );
      
      res.json({ 
        message: 'Invitation sent successfully',
        invited_at: new Date().toISOString(),
        confirmation_token: confirmationToken,
        language: emailLanguage,
        accommodation,
        covered_nights
      });
    } catch (emailError) {
      console.error('Email error:', emailError);
      res.status(500).json({ error: 'Failed to send email: ' + emailError.message });
    }
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;