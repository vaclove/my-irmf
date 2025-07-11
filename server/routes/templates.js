const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const router = express.Router();

// Get all templates for an edition
router.get('/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    const result = await pool.query(`
      SELECT * FROM email_templates 
      WHERE edition_id = $1 
      ORDER BY language
    `, [editionId]);
    
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_templates_by_edition', editionId: req.params.editionId });
    res.status(500).json({ error: error.message });
  }
});

// Get template by edition and language
router.get('/edition/:editionId/language/:language', async (req, res) => {
  try {
    const { editionId, language } = req.params;
    
    const result = await pool.query(`
      SELECT * FROM email_templates 
      WHERE edition_id = $1 AND language = $2
    `, [editionId, language]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'get_template_by_edition_language', editionId: req.params.editionId, language: req.params.language });
    res.status(500).json({ error: error.message });
  }
});

// Create or update template
router.put('/edition/:editionId/language/:language', async (req, res) => {
  try {
    const { editionId, language } = req.params;
    const { subject, html_content } = req.body;
    
    if (!subject || !html_content) {
      return res.status(400).json({ error: 'Subject and html_content are required' });
    }
    
    const result = await pool.query(`
      INSERT INTO email_templates (edition_id, language, subject, html_content, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (edition_id, language) 
      DO UPDATE SET 
        subject = EXCLUDED.subject,
        html_content = EXCLUDED.html_content,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [editionId, language, subject, html_content]);
    
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'create_update_template', editionId: req.params.editionId, language: req.params.language, formData: req.body });
    res.status(500).json({ error: error.message });
  }
});

// Get available template variables
router.get('/variables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM template_variables 
      ORDER BY name
    `);
    
    res.json(result.rows);
  } catch (error) {
    logError(error, req, { operation: 'get_template_variables' });
    res.status(500).json({ error: error.message });
  }
});

// Preview template with sample data
router.get('/preview/edition/:editionId/language/:language', async (req, res) => {
  try {
    const { editionId, language } = req.params;
    
    // Get template
    const templateResult = await pool.query(`
      SELECT * FROM email_templates 
      WHERE edition_id = $1 AND language = $2
    `, [editionId, language]);
    
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Get edition info for sample data
    const editionResult = await pool.query(`
      SELECT * FROM editions WHERE id = $1
    `, [editionId]);
    
    if (editionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Edition not found' });
    }
    
    const template = templateResult.rows[0];
    const edition = editionResult.rows[0];
    
    // Sample data for preview
    const sampleData = {
      guest_name: 'John Doe',
      edition_name: edition.name,
      category: 'filmmaker',
      confirmation_url: `${process.env.APP_URL}/confirm/sample-token`,
      accommodation_info: getAccommodationInfo(language, true, 3),
      company: 'Sample Film Studio'
    };
    
    // Replace variables in template
    let previewSubject = template.subject;
    let previewContent = template.html_content;
    
    Object.keys(sampleData).forEach(key => {
      const placeholder = `{{${key}}}`;
      previewSubject = previewSubject.replace(new RegExp(placeholder, 'g'), sampleData[key]);
      previewContent = previewContent.replace(new RegExp(placeholder, 'g'), sampleData[key]);
    });
    
    res.json({
      subject: previewSubject,
      html_content: previewContent
    });
  } catch (error) {
    logError(error, req, { operation: 'preview_template', editionId: req.params.editionId, language: req.params.language });
    res.status(500).json({ error: error.message });
  }
});

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

module.exports = router;