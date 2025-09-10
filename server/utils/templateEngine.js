// Email template engine with Markdown support and accommodation-aware rendering
const { marked } = require('marked');

/**
 * Process email template with Markdown conversion and variable replacement
 * @param {string} markdownContent - The Markdown template content
 * @param {object} variables - Variables to replace in template
 * @param {object} options - Rendering options
 * @returns {object} Processed template with HTML and subject
 */
function processTemplate(markdownContent, variables = {}, options = {}) {
  const {
    includeStyles = true,
    accommodationAware = true,
    isPreview = false
  } = options;

  if (!markdownContent) {
    return { html: '', text: markdownContent };
  }

  // First, handle accommodation-aware content
  let processedContent = accommodationAware 
    ? processAccommodationSections(markdownContent, variables)
    : markdownContent;

  // Replace template variables
  processedContent = replaceTemplateVariables(processedContent, variables);

  // Convert Markdown to HTML
  const htmlContent = marked(processedContent);

  // Wrap in email template with styles
  const styledHtml = includeStyles 
    ? wrapInEmailTemplate(htmlContent, variables, isPreview)
    : htmlContent;

  return {
    html: styledHtml,
    text: processedContent // Keep Markdown version for text emails
  };
}

/**
 * Process accommodation-aware sections in template
 * @param {string} content - Template content
 * @param {object} variables - Template variables
 * @returns {string} Processed content
 */
function processAccommodationSections(content, variables) {
  const hasAccommodation = variables.has_accommodation || 
                          (variables.accommodation_nights && variables.accommodation_nights > 0) ||
                          (variables.accommodation_info && variables.accommodation_info.trim() !== '');

  // Remove accommodation sections if guest doesn't have accommodation
  if (!hasAccommodation) {
    // Remove sections marked with accommodation markers
    content = content.replace(/\{\{#if_accommodation\}\}[\s\S]*?\{\{\/if_accommodation\}\}/g, '');
    
    // Remove standalone accommodation_info variables to prevent empty spaces
    content = content.replace(/\{\{accommodation_info\}\}/g, '');
    
    // Clean up extra whitespace that might be left
    content = content.replace(/\n\s*\n\s*\n/g, '\n\n'); // Remove triple+ newlines
  } else {
    // Process accommodation sections - remove markers but keep content
    content = content.replace(/\{\{#if_accommodation\}\}/g, '');
    content = content.replace(/\{\{\/if_accommodation\}\}/g, '');
  }

  return content;
}

/**
 * Replace template variables in content
 * @param {string} content - Content with template variables
 * @param {object} variables - Variables to replace
 * @returns {string} Content with variables replaced
 */
function replaceTemplateVariables(content, variables) {
  let processedContent = content;

  // Standard variable replacement
  Object.keys(variables).forEach(key => {
    const placeholder = `{{${key}}}`;
    const value = variables[key] || '';
    processedContent = processedContent.replace(new RegExp(placeholder, 'g'), value);
  });

  // Handle special accommodation info with proper formatting
  let accommodationHtml = '';
  if (variables.accommodation_info && variables.accommodation_info.trim()) {
    // Use provided accommodation info (should already be processed)
    accommodationHtml = variables.accommodation_info.trim();
  } else {
    // Generate default accommodation content
    accommodationHtml = generateAccommodationInfo(
      variables.accommodation_nights, 
      variables.language || 'english'
    );
  }
  processedContent = processedContent.replace(/\{\{accommodation_info\}\}/g, accommodationHtml);

  // Handle accommodation dates info for confirmation emails
  let accommodationDatesHtml = '';
  if (variables.accommodation_dates && Array.isArray(variables.accommodation_dates) && variables.accommodation_dates.length > 0) {
    accommodationDatesHtml = generateAccommodationDatesInfo(
      variables.accommodation_dates,
      variables.language || 'english'
    );
  }
  processedContent = processedContent.replace(/\{\{accommodation_dates_info\}\}/g, accommodationDatesHtml);

  return processedContent;
}

/**
 * Generate accommodation information HTML
 * @param {number} nights - Number of accommodation nights
 * @param {string} language - Language for accommodation text
 * @returns {string} Formatted accommodation HTML
 */
function generateAccommodationInfo(nights, language = 'english') {
  if (!nights || nights <= 0) return '';

  const accommodationText = {
    english: {
      single: `**🏨 Accommodation Included**\n\nWe have arranged accommodation for you for **1 night** during the festival.`,
      multiple: `**🏨 Accommodation Included**\n\nWe have arranged accommodation for you for **${nights} nights** during the festival.`
    },
    czech: {
      single: `**🏨 Ubytování zahrnuto**\n\nZajistili jsme pro Vás ubytování na **1 noc** během festivalu.`,
      multiple: `**🏨 Ubytování zahrnuto**\n\nZajistili jsme pro Vás ubytování na **${nights} nocí** během festivalu.`
    }
  };

  return nights === 1 
    ? accommodationText[language].single 
    : accommodationText[language].multiple;
}

/**
 * Generate accommodation dates information for confirmation emails
 * @param {Array} accommodationDates - Array of accommodation date strings
 * @param {string} language - Language for accommodation text
 * @returns {string} Formatted accommodation dates HTML
 */
function generateAccommodationDatesInfo(accommodationDates, language = 'english') {
  if (!accommodationDates || !Array.isArray(accommodationDates) || accommodationDates.length === 0) {
    return '';
  }

  // Format dates according to language
  const dateFormatter = new Intl.DateTimeFormat(language === 'czech' ? 'cs-CZ' : 'en-US', {
    weekday: 'long',
    day: 'numeric', 
    month: 'long'
  });
  
  const formattedDates = accommodationDates.map(date => 
    dateFormatter.format(new Date(date + 'T00:00:00'))
  ).join(', ');

  const accommodationDatesText = {
    english: `Your accommodation has been confirmed for the following dates: **${formattedDates}**`,
    czech: `Vaše ubytování bylo potvrzeno na následující data: **${formattedDates}**`
  };

  return accommodationDatesText[language];
}

/**
 * Wrap HTML content in professional email template
 * @param {string} htmlContent - The main email content
 * @param {object} variables - Template variables for personalization
 * @param {boolean} isPreview - Whether this is for preview (affects styling scope)
 * @returns {string} Complete HTML email
 */
function wrapInEmailTemplate(htmlContent, variables = {}, isPreview = false) {
  // Note: IRMF stands for International Road Movie Festival, contact: irmf@irmf.cz
  const logoUrl = 'https://irmf.cz/wp-content/uploads/2022/07/irmf_web_logo_90px_black.png';
  
  // For preview, return just the styled content without full HTML document
  if (isPreview) {
    return `
    <style>
        .email-preview-container {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            max-width: 600px;
            margin: 0 auto;
            padding: 0;
            background-color: #ffffff;
        }
        .email-preview-container .email-container {
            background-color: #ffffff;
            margin: 0;
            border: 1px solid #e5e7eb;
            overflow: hidden;
        }
        .email-preview-container .header {
            background-color: #f9fafb;
            color: #374151;
            padding: 20px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }
        .email-preview-container .header img {
            max-height: 30px;
            margin: 0;
            filter: none;
        }
        .email-preview-container .header h1 {
            margin: 0;
            font-size: 20px;
            font-weight: 500;
            color: #374151;
        }
        .email-preview-container .header p {
            margin: 5px 0 0 0;
            font-size: 13px;
            color: #6b7280;
        }
        .email-preview-container .content {
            padding: 30px 25px;
            background-color: #ffffff;
        }
        .email-preview-container .content h1, .email-preview-container .content h2, .email-preview-container .content h3 {
            color: #374151;
            margin-top: 0;
        }
        .email-preview-container .content h1 {
            font-size: 24px;
            margin-bottom: 20px;
            font-weight: 500;
        }
        .email-preview-container .content h2 {
            font-size: 20px;
            margin-bottom: 15px;
            font-weight: 500;
        }
        .email-preview-container .content h3 {
            font-size: 16px;
            margin-bottom: 10px;
            font-weight: 500;
        }
        .email-preview-container .content p {
            margin-bottom: 15px;
            font-size: 15px;
            color: #374151;
        }
        .email-preview-container .content strong {
            color: #111827;
            font-weight: 600;
        }
        .email-preview-container .content a {
            color: #374151;
            text-decoration: underline;
            font-weight: 500;
        }
        .email-preview-container .content a:hover {
            color: #111827;
        }
        .email-preview-container .button {
            display: inline-block;
            background-color: #374151;
            color: white !important;
            padding: 12px 25px;
            text-decoration: none;
            border: 1px solid #374151;
            font-weight: 500;
            margin: 20px 0;
            text-align: center;
        }
        .email-preview-container .button:hover {
            background-color: #111827;
            border-color: #111827;
            text-decoration: none !important;
        }
        .email-preview-container .accommodation-info {
            background-color: #f9fafb;
            border: 1px solid #e5e7eb;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
        }
        .email-preview-container .accommodation-info strong {
            color: #374151;
            font-size: 16px;
        }
        .email-preview-container .footer {
            background-color: #f9fafb;
            padding: 20px 25px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
        }
        .email-preview-container .footer p {
            margin: 0;
            font-size: 13px;
            color: #6b7280;
        }
        .email-preview-container .footer a {
            color: #374151;
            text-decoration: none;
        }
        .email-preview-container .footer a:hover {
            text-decoration: underline;
        }
        @media only screen and (max-width: 600px) {
            .email-preview-container .email-container {
                margin: 0;
                border: none;
            }
            .email-preview-container .content {
                padding: 20px 15px;
            }
            .email-preview-container .header {
                padding: 15px;
            }
            .email-preview-container .footer {
                padding: 15px;
            }
        }
    </style>
    <div class="email-preview-container">
        <div class="email-container">
            <div class="header">
                <img src="${logoUrl}" alt="IRMF Logo" />
            </div>
            
            <div class="content">
                ${htmlContent}
            </div>
            
            <div class="footer">
                <p>
                    <strong>International Road Movie Festival</strong><br>
                    <a href="https://irmf.cz">www.irmf.cz</a> | 
                    <a href="mailto:irmf@irmf.cz">irmf@irmf.cz</a>
                </p>
            </div>
        </div>
    </div>`;
  }
  
  return `
<!DOCTYPE html>
<html lang="${variables.language === 'czech' ? 'cs' : 'en'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${variables.subject || 'Festival Invitation'}</title>
    <style>
        .email-preview-body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            max-width: 600px;
            margin: 0 auto;
            padding: 0;
            background-color: #ffffff;
        }
        .email-container {
            background-color: #ffffff;
            margin: 0;
            border: 1px solid #e5e7eb;
            overflow: hidden;
        }
        .header {
            background-color: #f9fafb;
            color: #374151;
            padding: 20px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }
        .header img {
            max-height: 30px;
            margin: 0;
            filter: none;
        }
        .header h1 {
            margin: 0;
            font-size: 20px;
            font-weight: 500;
            color: #374151;
        }
        .header p {
            margin: 5px 0 0 0;
            font-size: 13px;
            color: #6b7280;
        }
        .content {
            padding: 30px 25px;
            background-color: #ffffff;
        }
        .content h1, .content h2, .content h3 {
            color: #374151;
            margin-top: 0;
        }
        .content h1 {
            font-size: 24px;
            margin-bottom: 20px;
            font-weight: 500;
        }
        .content h2 {
            font-size: 20px;
            margin-bottom: 15px;
            font-weight: 500;
        }
        .content h3 {
            font-size: 16px;
            margin-bottom: 10px;
            font-weight: 500;
        }
        .content p {
            margin-bottom: 15px;
            font-size: 15px;
            color: #374151;
        }
        .content strong {
            color: #111827;
            font-weight: 600;
        }
        .content a {
            color: #374151;
            text-decoration: underline;
            font-weight: 500;
        }
        .content a:hover {
            color: #111827;
        }
        .button {
            display: inline-block;
            background-color: #374151;
            color: white !important;
            padding: 12px 25px;
            text-decoration: none;
            border: 1px solid #374151;
            font-weight: 500;
            margin: 20px 0;
            text-align: center;
        }
        .button:hover {
            background-color: #111827;
            border-color: #111827;
            text-decoration: none !important;
        }
        .accommodation-info {
            background-color: #f9fafb;
            border: 1px solid #e5e7eb;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
        }
        .accommodation-info strong {
            color: #374151;
            font-size: 16px;
        }
        .footer {
            background-color: #f9fafb;
            padding: 20px 25px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
        }
        .footer p {
            margin: 0;
            font-size: 13px;
            color: #6b7280;
        }
        .footer a {
            color: #374151;
            text-decoration: none;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        @media only screen and (max-width: 600px) {
            .email-container {
                margin: 0;
                border: none;
            }
            .content {
                padding: 20px 15px;
            }
            .header {
                padding: 15px;
            }
            .footer {
                padding: 15px;
            }
        }
    </style>
</head>
<body class="email-preview-body">
    <div class="email-container">
        <div class="header">
            <img src="${logoUrl}" alt="IRMF Logo" />
        </div>
        
        <div class="content">
            ${htmlContent}
        </div>
        
        <div class="footer">
            <p>
                <strong>International Road Movie Festival</strong><br>
                <a href="https://irmf.cz">www.irmf.cz</a> | 
                <a href="mailto:irmf@irmf.cz">irmf@irmf.cz</a>
            </p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generate sample data for template preview
 * @param {string} language - Language for sample data
 * @param {object} options - Preview options
 * @returns {object} Sample template variables
 */
function generateSampleData(language = 'english', options = {}) {
  const {
    withAccommodation = true,
    accommodationNights = 2,
    templateType = 'invitation'
  } = options;

  const sampleData = {
    greeting: language === 'czech' ? 'Vážený pane Nováku' : 'Dear Mr. Smith',
    guest_name: language === 'czech' ? 'Jan Novák' : 'John Smith',
    edition_name: language === 'czech' ? 'IRMF 2024 - Mezinárodní festival road movies' : 'IRMF 2024 - International Road Movie Festival',
    category: language === 'czech' ? 'filmař' : 'filmmaker',
    confirmation_url: 'https://my.irmf.cz/confirm/sample-token-123',
    company: language === 'czech' ? 'Filmová společnost Praha' : 'Prague Film Company',
    language: language,
    has_accommodation: withAccommodation,
    accommodation_nights: withAccommodation ? accommodationNights : 0
  };

  if (withAccommodation) {
    sampleData.accommodation_info = generateAccommodationInfo(accommodationNights, language);
    
    // For confirmation templates, also include sample accommodation dates
    if (templateType === 'confirmation') {
      const today = new Date();
      const sampleDates = [];
      
      // Create sample dates for the accommodation nights
      for (let i = 0; i < accommodationNights; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i + 1); // Start from tomorrow
        sampleDates.push(date.toISOString().split('T')[0]); // Format as YYYY-MM-DD
      }
      
      sampleData.accommodation_dates = sampleDates;
      sampleData.has_accommodation_dates = true;
      
      // Add confirmed_at for confirmation emails
      sampleData.confirmed_at = new Date().toLocaleString(language === 'czech' ? 'cs-CZ' : 'en-US');
    }
  }

  return sampleData;
}

module.exports = {
  processTemplate,
  generateSampleData,
  replaceTemplateVariables,
  processAccommodationSections,
  wrapInEmailTemplate,
  generateAccommodationDatesInfo
};