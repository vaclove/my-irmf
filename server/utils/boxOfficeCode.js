const crypto = require('crypto');
const { generateLuhnCheckDigit } = require('./luhn');

/**
 * Box-office ticket codes: 4NNNNNNNNC, 10 digits where NNNNNNNN is random and C a
 * Luhn check digit. The length and prefix keep them apart from badges (7 digits),
 * one-time tickets (30XXXXC) and GoOut tickets (13 digits); the random part keeps
 * them from being guessed, and the check digit rejects misreads.
 */

function generateBoxOfficeCode() {
  const partial = `4${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`;
  return partial + generateLuhnCheckDigit(partial);
}

function isBoxOfficeCode(code) {
  return /^4\d{9}$/.test(code) && generateLuhnCheckDigit(code.slice(0, 9)) === Number(code[9]);
}

module.exports = { generateBoxOfficeCode, isBoxOfficeCode };
