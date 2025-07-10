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

// Send invitation to guest for specific edition
router.post('/send', async (req, res) => {
  try {
    const { guest_id, edition_id } = req.body;
    
    if (!guest_id || !edition_id) {
      return res.status(400).json({ error: 'Guest ID and Edition ID are required' });
    }
    
    // Check if assignment exists
    const assignmentResult = await pool.query(`
      SELECT ge.*, g.name, g.email, e.name as edition_name, e.year
      FROM guest_editions ge
      JOIN guests g ON ge.guest_id = g.id
      JOIN editions e ON ge.edition_id = e.id
      WHERE ge.guest_id = $1 AND ge.edition_id = $2
    `, [guest_id, edition_id]);
    
    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Guest assignment not found' });
    }
    
    const assignment = assignmentResult.rows[0];
    
    // Generate confirmation token
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    
    // Send email
    const confirmationUrl = `${process.env.APP_URL}/confirm/${confirmationToken}`;
    
    try {
      const emailData = {
        to: assignment.email,
        subject: `Invitation to ${assignment.edition_name}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Festival Invitation</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">🎬 Festival Invitation</h1>
            </div>
            
            <div style="background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <h2 style="color: #667eea; margin-top: 0;">You're Invited to ${assignment.edition_name}!</h2>
              
              <p style="font-size: 16px;">Dear <strong>${assignment.name}</strong>,</p>
              
              <p style="font-size: 16px;">We are excited to invite you to participate in <strong>${assignment.edition_name}</strong> as a <strong style="color: #667eea;">${assignment.category}</strong>.</p>
              
              <div style="background: #f8f9ff; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <p style="margin: 0; font-size: 16px;">Please confirm your attendance by clicking the button below:</p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${confirmationUrl}" 
                   style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                          color: white; 
                          padding: 15px 30px; 
                          text-decoration: none; 
                          border-radius: 25px; 
                          font-weight: bold; 
                          font-size: 16px;
                          display: inline-block;
                          transition: transform 0.2s;">
                  ✓ Confirm Attendance
                </a>
              </div>
              
              <p style="font-size: 14px; color: #666; border-top: 1px solid #eee; padding-top: 20px;">
                <strong>Can't click the button?</strong> Copy and paste this link into your browser:<br>
                <span style="background: #f1f1f1; padding: 5px; border-radius: 3px; word-break: break-all;">${confirmationUrl}</span>
              </p>
              
              <p style="font-size: 16px; margin-top: 30px;">We look forward to your participation!</p>
              
              <p style="font-size: 16px; margin-bottom: 0;">
                Best regards,<br>
                <strong>The Festival Team</strong>
              </p>
            </div>
          </body>
          </html>
        `,
      };
      
      await sendEmail(emailData);
      
      // Only update database after successful email sending
      await pool.query(
        'UPDATE guest_editions SET invited_at = CURRENT_TIMESTAMP, confirmation_token = $1 WHERE guest_id = $2 AND edition_id = $3',
        [confirmationToken, guest_id, edition_id]
      );
      
      res.json({ 
        message: 'Invitation sent successfully',
        invited_at: new Date().toISOString(),
        confirmation_token: confirmationToken
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