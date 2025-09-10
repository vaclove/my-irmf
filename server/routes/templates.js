const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware, captureOriginalData } = require('../utils/auditLogger');
const { processTemplate, generateSampleData } = require('../utils/templateEngine');
const router = express.Router();

// Apply audit middleware to all routes
// Note: captureOriginalData must come before auditMiddleware
router.use(captureOriginalData('templates'));
router.use(auditMiddleware('templates'));

// Get all templates for an edition
router.get('/edition/:editionId', async (req, res) => {
  try {
    const { editionId } = req.params;
    
    // For now, get templates by language since we don't have edition_id in current schema
    const result = await pool.query(`
      SELECT * FROM email_templates 
      ORDER BY language
    `);
    
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
    const { type = 'invitation' } = req.query; // Default to invitation for backward compatibility
    
    const result = await pool.query(`
      SELECT * FROM email_templates 
      WHERE edition_id = $1 AND language = $2 AND template_type = $3
      ORDER BY created_at DESC
      LIMIT 1
    `, [editionId, language, type]);
    
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
    const { subject, markdown_content, html_content, accommodation_content, template_type = 'invitation' } = req.body;
    
    if (!subject || (!markdown_content && !html_content)) {
      return res.status(400).json({ error: 'Subject and either markdown_content or html_content are required' });
    }
    
    // If markdown_content is provided, use it; otherwise fall back to html_content for backward compatibility
    const finalMarkdownContent = markdown_content || null;
    const finalHtmlContent = html_content || markdown_content || '';
    const finalAccommodationContent = accommodation_content || null;
    
    // Generate a template name based on type and language
    const templateName = `${template_type}_${language}`;
    
    const result = await pool.query(`
      INSERT INTO email_templates (name, edition_id, language, subject, body, markdown_content, accommodation_content, template_type, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (edition_id, language, template_type) 
      DO UPDATE SET 
        name = EXCLUDED.name,
        subject = EXCLUDED.subject,
        body = EXCLUDED.body,
        markdown_content = EXCLUDED.markdown_content,
        accommodation_content = EXCLUDED.accommodation_content,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [templateName, editionId, language, subject, finalHtmlContent, finalMarkdownContent, finalAccommodationContent, template_type]);
    
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

// Preview template with provided content (for unsaved changes)
router.post('/preview/edition/:editionId/language/:language', async (req, res) => {
  try {
    const { editionId, language } = req.params;
    const { subject, markdown_content, accommodation_content, template_type = 'invitation' } = req.body;
    const { withAccommodation = 'true', accommodationNights = '2' } = req.query;
    
    if (!markdown_content) {
      return res.status(400).json({ error: 'markdown_content is required' });
    }
    
    // Get edition info for sample data
    const editionResult = await pool.query(`
      SELECT * FROM editions WHERE id = $1
    `, [editionId]);
    
    if (editionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Edition not found' });
    }
    
    const edition = editionResult.rows[0];
    
    // Generate sample data with accommodation options
    const sampleData = generateSampleData(language, {
      withAccommodation: withAccommodation === 'true',
      accommodationNights: parseInt(accommodationNights) || 2,
      templateType: template_type
    });
    
    // Override with actual edition data
    sampleData.edition_name = edition.name;
    sampleData.subject = subject || 'Preview Subject';
    
    // If custom accommodation content is provided, process it and use instead of generated content
    if (accommodation_content && accommodation_content.trim()) {
      let processedAccommodationContent = accommodation_content.trim();
      
      // Add special night text variable with language-aware grammar
      const nights = parseInt(sampleData.accommodation_nights) || 0;
      const language = sampleData.language || 'english';
      
      let accommodationNightsText = '';
      if (language === 'czech') {
        const nightText = nights === 1 ? 'noc' : (nights >= 2 && nights <= 4 ? 'noci' : 'nocí');
        accommodationNightsText = `${nights} ${nightText}`;
      } else {
        const nightText = nights === 1 ? 'night' : 'nights';
        accommodationNightsText = `${nights} ${nightText}`;
      }
      
      const extendedVariables = {
        ...sampleData,
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
      
      sampleData.accommodation_info = processedAccommodationContent;
    }
    
    // Process template content
    const processed = processTemplate(markdown_content, sampleData, { isPreview: true });
    
    // Replace variables in subject
    let previewSubject = subject || 'Preview Subject';
    Object.keys(sampleData).forEach(key => {
      const placeholder = `{{${key}}}`;
      previewSubject = previewSubject.replace(new RegExp(placeholder, 'g'), sampleData[key] || '');
    });
    
    res.json({
      subject: previewSubject,
      html_content: processed.html,
      text_content: processed.text,
      sample_data: sampleData
    });
  } catch (error) {
    logError(error, req, { operation: 'preview_template_with_content', editionId: req.params.editionId, language: req.params.language });
    res.status(500).json({ error: error.message });
  }
});

// Preview template with sample data
router.get('/preview/edition/:editionId/language/:language', async (req, res) => {
  try {
    const { editionId, language } = req.params;
    const { withAccommodation = 'true', accommodationNights = '2' } = req.query;
    
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
    
    // Generate sample data with accommodation options
    const sampleData = generateSampleData(language, {
      withAccommodation: withAccommodation === 'true',
      accommodationNights: parseInt(accommodationNights) || 2,
      templateType: template.template_type || 'invitation'
    });
    
    // Override with actual edition data
    sampleData.edition_name = edition.name;
    sampleData.subject = template.subject;
    
    // Process template content
    const templateContent = template.markdown_content || template.body || '';
    const processed = processTemplate(templateContent, sampleData, { isPreview: true });
    
    // Replace variables in subject
    let previewSubject = template.subject;
    Object.keys(sampleData).forEach(key => {
      const placeholder = `{{${key}}}`;
      previewSubject = previewSubject.replace(new RegExp(placeholder, 'g'), sampleData[key] || '');
    });
    
    res.json({
      subject: previewSubject,
      html_content: processed.html,
      text_content: processed.text,
      sample_data: sampleData
    });
  } catch (error) {
    logError(error, req, { operation: 'preview_template', editionId: req.params.editionId, language: req.params.language });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;