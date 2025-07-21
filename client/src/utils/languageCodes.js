// Language codes and names for movie languages and subtitles
// Using ISO 639-1 codes for standardization and easy translation support

export const LANGUAGES = {
  // Most common languages for international films
  'en': 'English',
  'cs': 'Czech',
  'sk': 'Slovak',
  'de': 'German',
  'fr': 'French',
  'it': 'Italian',
  'es': 'Spanish',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'pl': 'Polish',
  'hu': 'Hungarian',
  'nl': 'Dutch',
  'sv': 'Swedish',
  'da': 'Danish',
  'no': 'Norwegian',
  'fi': 'Finnish',
  'is': 'Icelandic',
  'ro': 'Romanian',
  'bg': 'Bulgarian',
  'hr': 'Croatian',
  'sr': 'Serbian',
  'sl': 'Slovenian',
  'mk': 'Macedonian',
  'sq': 'Albanian',
  'el': 'Greek',
  'tr': 'Turkish',
  'ar': 'Arabic',
  'he': 'Hebrew',
  'fa': 'Persian',
  'hi': 'Hindi',
  'ur': 'Urdu',
  'zh': 'Chinese',
  'ja': 'Japanese',
  'ko': 'Korean',
  'th': 'Thai',
  'vi': 'Vietnamese',
  'id': 'Indonesian',
  'ms': 'Malay',
  'tl': 'Filipino',
  'sw': 'Swahili',
  'am': 'Amharic',
  'yo': 'Yoruba',
  'zu': 'Zulu',
  'af': 'Afrikaans',
  'eu': 'Basque',
  'ca': 'Catalan',
  'gl': 'Galician',
  'cy': 'Welsh',
  'ga': 'Irish',
  'mt': 'Maltese',
  'is': 'Icelandic',
  'fo': 'Faroese',
  'et': 'Estonian',
  'lv': 'Latvian',
  'lt': 'Lithuanian',
  'be': 'Belarusian',
  'uk': 'Ukrainian',
  'kk': 'Kazakh',
  'ky': 'Kyrgyz',
  'uz': 'Uzbek',
  'mn': 'Mongolian',
  'ka': 'Georgian',
  'hy': 'Armenian',
  'az': 'Azerbaijani',
  'bn': 'Bengali',
  'ta': 'Tamil',
  'te': 'Telugu',
  'ml': 'Malayalam',
  'kn': 'Kannada',
  'gu': 'Gujarati',
  'pa': 'Punjabi',
  'mr': 'Marathi',
  'or': 'Odia',
  'as': 'Assamese',
  'ne': 'Nepali',
  'si': 'Sinhala',
  'my': 'Burmese',
  'km': 'Khmer',
  'lo': 'Lao'
};

/**
 * Get language name by code
 * @param {string} code - Language code (e.g., 'en', 'cs')
 * @returns {string} Language name or the code if not found
 */
export const getLanguageName = (code) => {
  if (!code) return '';
  return LANGUAGES[code.toLowerCase()] || code;
};

/**
 * Get formatted display for multiple languages
 * @param {string} codes - Comma-separated language codes (e.g., 'en,cs,de')
 * @returns {object} Formatted language information
 */
export const formatLanguagesDisplay = (codes) => {
  if (!codes || !codes.trim()) {
    return { languages: [], isMultiple: false };
  }

  const codeArray = codes.split(',').map(code => code.trim()).filter(Boolean);
  const languages = codeArray.map(code => ({
    code: code.toUpperCase(),
    name: getLanguageName(code)
  }));

  return {
    languages,
    isMultiple: languages.length > 1
  };
};

/**
 * Get all languages as sorted array for dropdowns
 * @returns {Array} Array of {code, name} objects sorted by name
 */
export const getLanguageOptions = () => {
  return Object.entries(LANGUAGES)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Convert language codes to display string
 * @param {string} codes - Comma-separated language codes
 * @returns {string} Human-readable language names
 */
export const formatLanguageCodesForDisplay = (codes) => {
  if (!codes) return '';
  
  const display = formatLanguagesDisplay(codes);
  return display.languages.map(lang => lang.name).join(', ');
};