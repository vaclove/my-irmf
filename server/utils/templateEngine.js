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
    accommodationAware = true
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
    ? wrapInEmailTemplate(htmlContent, variables)
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
  if (variables.accommodation_info) {
    const accommodationHtml = generateAccommodationInfo(
      variables.accommodation_nights, 
      variables.language || 'english'
    );
    processedContent = processedContent.replace(/\{\{accommodation_info\}\}/g, accommodationHtml);
  }

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
 * Wrap HTML content in professional email template
 * @param {string} htmlContent - The main email content
 * @param {object} variables - Template variables for personalization
 * @returns {string} Complete HTML email
 */
function wrapInEmailTemplate(htmlContent, variables = {}) {
  const logoUrl = 'https://irmf.cz/wp-content/uploads/2022/07/irmf_web_logo_90px_black.png';
  const festivalName = variables.edition_name || 'International Roma Music Festival';
  
  return `
<!DOCTYPE html>
<html lang="${variables.language === 'czech' ? 'cs' : 'en'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${variables.subject || 'Festival Invitation'}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            max-width: 600px;
            margin: 0 auto;
            padding: 0;
            background-color: #f8f9fa;
        }
        .email-container {
            background-color: #ffffff;
            margin: 20px auto;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
            color: white;
            padding: 30px 20px;
            text-align: center;
        }
        .header img {
            max-height: 60px;
            margin-bottom: 15px;
            filter: brightness(0) invert(1);
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
        }
        .header p {
            margin: 5px 0 0 0;
            font-size: 14px;
            opacity: 0.9;
        }
        .content {
            padding: 40px 30px;
            background-color: #ffffff;
        }
        .content h1, .content h2, .content h3 {
            color: #1e3a8a;
            margin-top: 0;
        }
        .content h1 {
            font-size: 28px;
            margin-bottom: 20px;
        }
        .content h2 {
            font-size: 22px;
            margin-bottom: 15px;
        }
        .content h3 {
            font-size: 18px;
            margin-bottom: 10px;
        }
        .content p {
            margin-bottom: 15px;
            font-size: 16px;
        }
        .content strong {
            color: #1e3a8a;
        }
        .content a {
            color: #3b82f6;
            text-decoration: none;
            font-weight: 500;
        }
        .content a:hover {
            text-decoration: underline;
        }
        .button {
            display: inline-block;
            background-color: #3b82f6;
            color: white !important;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 20px 0;
            text-align: center;
        }
        .button:hover {
            background-color: #2563eb;
            text-decoration: none !important;
        }
        .accommodation-info {
            background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
            border: 1px solid #93c5fd;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
        }
        .accommodation-info strong {
            color: #1e40af;
            font-size: 18px;
        }
        .footer {
            background-color: #f1f5f9;
            padding: 25px 30px;
            text-align: center;
            border-top: 1px solid #e2e8f0;
        }
        .footer p {
            margin: 0;
            font-size: 14px;
            color: #64748b;
        }
        .footer a {
            color: #3b82f6;
            text-decoration: none;
        }
        @media only screen and (max-width: 600px) {
            .email-container {
                margin: 0;
                border-radius: 0;
            }
            .content {
                padding: 25px 20px;
            }
            .header {
                padding: 20px 15px;
            }
            .footer {
                padding: 20px 15px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <img src="${logoUrl}" alt="IRMF Logo" />
            <h1>${festivalName}</h1>
            <p>International Roma Music Festival</p>
        </div>
        
        <div class="content">
            ${htmlContent}
        </div>
        
        <div class="footer">
            <p>
                <strong>International Roma Music Festival</strong><br>
                <a href="https://irmf.cz">www.irmf.cz</a> | 
                <a href="mailto:info@irmf.cz">info@irmf.cz</a>
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
    accommodationNights = 2
  } = options;

  const sampleData = {
    greeting: language === 'czech' ? 'Vážený pane Nováku' : 'Dear Mr. Smith',
    guest_name: language === 'czech' ? 'Jan Novák' : 'John Smith',
    edition_name: language === 'czech' ? 'IRMF 2024 - Mezinárodní festival romské hudby' : 'IRMF 2024 - International Roma Music Festival',
    category: language === 'czech' ? 'filmař' : 'filmmaker',
    confirmation_url: 'https://my.irmf.cz/confirm/sample-token-123',
    company: language === 'czech' ? 'Filmová společnost Praha' : 'Prague Film Company',
    language: language,
    has_accommodation: withAccommodation,
    accommodation_nights: withAccommodation ? accommodationNights : 0
  };

  if (withAccommodation) {
    sampleData.accommodation_info = generateAccommodationInfo(accommodationNights, language);
  }

  return sampleData;
}

module.exports = {
  processTemplate,
  generateSampleData,
  replaceTemplateVariables,
  processAccommodationSections,
  wrapInEmailTemplate
};