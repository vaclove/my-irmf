/**
 * Luhn algorithm utilities for one-time ticket validation
 * Format: 30XXXXC where XXXX is ticket number (0000-9999) and C is check digit
 */

/**
 * Generate Luhn check digit for a partial code
 * @param {string} partialCode - The code without check digit
 * @returns {number} The check digit (0-9)
 */
function generateLuhnCheckDigit(partialCode) {
  let sum = 0;
  let shouldDouble = true;

  // Process digits right to left
  for (let i = partialCode.length - 1; i >= 0; i--) {
    let digit = parseInt(partialCode[i]);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit;
}

/**
 * Generate a complete one-time ticket code
 * @param {number} sequence - Ticket sequence number (0-9999)
 * @returns {string} Complete 7-digit ticket code
 */
function generateTicketCode(sequence) {
  if (sequence < 0 || sequence > 9999) {
    throw new Error('Sequence must be between 0 and 9999');
  }

  const partial = `30${String(sequence).padStart(4, '0')}`;
  const checkDigit = generateLuhnCheckDigit(partial);
  return partial + checkDigit;
}

/**
 * Validate a one-time ticket code using Luhn algorithm
 * @param {string} code - The 7-digit ticket code
 * @returns {boolean} True if valid, false otherwise
 */
function isValidTicketCode(code) {
  // Must be exactly 7 digits
  if (!/^\d{7}$/.test(code)) {
    return false;
  }

  // Must start with '30'
  if (!code.startsWith('30')) {
    return false;
  }

  // Validate check digit
  const checkDigit = parseInt(code[6]);
  const partial = code.substring(0, 6);
  const expectedCheckDigit = generateLuhnCheckDigit(partial);

  return checkDigit === expectedCheckDigit;
}

/**
 * Extract sequence number from a valid ticket code
 * @param {string} code - The 7-digit ticket code
 * @returns {number|null} Sequence number (0-9999) or null if invalid
 */
function getTicketSequence(code) {
  if (!isValidTicketCode(code)) {
    return null;
  }

  return parseInt(code.substring(2, 6));
}

module.exports = {
  generateLuhnCheckDigit,
  generateTicketCode,
  isValidTicketCode,
  getTicketSequence
};
