// Greeting generation service for email personalization
// Supports English and Czech with appropriate cultural conventions

const { detectGender } = require('./genderDetection');
const { declineSurnameToVocative, getCzechHonorific, isLikelyCzechSurname } = require('./czechDeclension');

/**
 * Generate appropriate greeting based on name and language
 * @param {string} firstName - Guest's first name
 * @param {string} lastName - Guest's last name
 * @param {string} language - Language preference ('english' or 'czech')
 * @param {object} options - Additional options for greeting generation
 * @returns {object} Generated greeting with metadata
 */
function generateGreeting(firstName, lastName, language = 'english', options = {}) {
  const {
    formal = true,
    fallbackToFirstName = true
  } = options;
  
  // Normalize inputs
  const normalizedFirstName = (firstName || '').trim();
  const normalizedLastName = (lastName || '').trim();
  const normalizedLanguage = (language || 'english').toLowerCase();
  
  // Detect gender for appropriate honorifics
  const gender = detectGender(normalizedFirstName, normalizedLastName, normalizedLanguage);
  
  let greeting = '';
  let confidence = 'high';
  let method = '';
  
  try {
    if (normalizedLanguage === 'czech') {
      greeting = generateCzechGreeting(normalizedFirstName, normalizedLastName, gender, formal, fallbackToFirstName);
      method = 'czech_formal';
    } else {
      greeting = generateEnglishGreeting(normalizedFirstName, normalizedLastName, gender, formal, fallbackToFirstName);
      method = 'english_formal';
    }
    
    // Determine confidence level
    if (!gender) {
      confidence = 'medium';
    }
    
    if (!normalizedLastName && formal) {
      confidence = 'low';
      method += '_fallback';
    }
    
  } catch (error) {
    // Fallback to simple greeting
    greeting = generateFallbackGreeting(normalizedFirstName, normalizedLastName, normalizedLanguage);
    confidence = 'low';
    method = 'fallback';
  }
  
  return {
    greeting: greeting || generateFallbackGreeting(normalizedFirstName, normalizedLastName, normalizedLanguage),
    confidence,
    method,
    detectedGender: gender,
    language: normalizedLanguage,
    metadata: {
      hasSurname: !!normalizedLastName,
      formal,
      isCzechSurname: isLikelyCzechSurname(normalizedLastName)
    }
  };
}

/**
 * Generate English greeting
 * @param {string} firstName 
 * @param {string} lastName 
 * @param {string} gender 
 * @param {boolean} formal 
 * @param {boolean} fallbackToFirstName 
 * @returns {string}
 */
function generateEnglishGreeting(firstName, lastName, gender, formal, fallbackToFirstName) {
  if (formal && lastName) {
    // Formal greeting with surname
    switch (gender) {
      case 'male':
        return `Dear Mr. ${lastName}`;
      case 'female':
        return `Dear Ms. ${lastName}`;
      default:
        // Unknown gender - use first name or gender-neutral approach
        if (fallbackToFirstName && firstName) {
          return `Dear ${firstName}`;
        }
        return `Dear Mr./Ms. ${lastName}`;
    }
  } else if (firstName) {
    // Informal or first-name greeting
    return `Dear ${firstName}`;
  }
  
  // Last resort
  return 'Dear Guest';
}

/**
 * Generate Czech greeting with proper declension
 * @param {string} firstName 
 * @param {string} lastName 
 * @param {string} gender 
 * @param {boolean} formal 
 * @param {boolean} fallbackToFirstName 
 * @returns {string}
 */
function generateCzechGreeting(firstName, lastName, gender, formal, fallbackToFirstName) {
  if (formal && lastName && gender) {
    // Formal Czech greeting with declined surname
    const honorific = getCzechHonorific(gender);
    const declinedSurname = declineSurnameToVocative(lastName, gender);
    return `Vážený ${honorific} ${declinedSurname}`;
  } else if (formal && lastName) {
    // Formal but unknown gender - use neutral form
    const honorific = getCzechHonorific('male'); // Default to male form
    const declinedSurname = declineSurnameToVocative(lastName, 'male');
    return `Vážený ${honorific} ${declinedSurname}`;
  } else if (firstName) {
    // Informal or first-name greeting
    if (gender === 'female') {
      return `Vážená ${firstName}`;
    } else {
      return `Vážený ${firstName}`;
    }
  }
  
  // Last resort
  return 'Vážený hosté'; // "Dear guests" - neutral plural
}

/**
 * Generate fallback greeting when main generation fails
 * @param {string} firstName 
 * @param {string} lastName 
 * @param {string} language 
 * @returns {string}
 */
function generateFallbackGreeting(firstName, lastName, language) {
  if (firstName) {
    return language === 'czech' ? `Vážený ${firstName}` : `Dear ${firstName}`;
  }
  
  if (lastName) {
    return language === 'czech' ? `Vážený pane ${lastName}` : `Dear ${lastName}`;
  }
  
  return language === 'czech' ? 'Vážený hoste' : 'Dear Guest';
}

/**
 * Validate greeting generation inputs
 * @param {string} firstName 
 * @param {string} lastName 
 * @param {string} language 
 * @returns {object} Validation result
 */
function validateGreetingInputs(firstName, lastName, language) {
  const errors = [];
  const warnings = [];
  
  if (!firstName && !lastName) {
    errors.push('At least first name or last name is required');
  }
  
  if (language && !['english', 'czech'].includes(language.toLowerCase())) {
    warnings.push(`Unsupported language '${language}', defaulting to English`);
  }
  
  if (!firstName) {
    warnings.push('First name missing - greeting quality may be reduced');
  }
  
  if (!lastName) {
    warnings.push('Last name missing - formal greeting not possible');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Generate multiple greeting options for user selection
 * @param {string} firstName 
 * @param {string} lastName 
 * @param {string} language 
 * @returns {array} Array of greeting options
 */
function generateGreetingOptions(firstName, lastName, language = 'english') {
  const options = [];
  
  // Formal option
  const formalGreeting = generateGreeting(firstName, lastName, language, { formal: true });
  options.push({
    ...formalGreeting,
    label: 'Formal',
    description: language === 'czech' ? 'Formální oslovení' : 'Formal address'
  });
  
  // Informal option (if different from formal)
  const informalGreeting = generateGreeting(firstName, lastName, language, { formal: false });
  if (informalGreeting.greeting !== formalGreeting.greeting) {
    options.push({
      ...informalGreeting,
      label: 'Informal',
      description: language === 'czech' ? 'Neformální oslovení' : 'Informal address'
    });
  }
  
  return options;
}

module.exports = {
  generateGreeting,
  generateGreetingOptions,
  validateGreetingInputs,
  generateEnglishGreeting,
  generateCzechGreeting,
  generateFallbackGreeting
};