// Czech surname declension utility for vocative case
// Used in formal greetings (e.g., "Vážený pane Nováku")

/**
 * Decline Czech surname to vocative case based on comprehensive Czech grammar rules
 * @param {string} surname - The surname to decline
 * @param {string} gender - The gender ('male' or 'female')
 * @returns {string} The declined surname
 */
function declineSurnameToVocative(surname, gender) {
  if (!surname) return '';
  
  const normalizedSurname = surname.trim();
  
  // Female surnames ending in -ová remain unchanged in vocative
  if (gender === 'female') {
    return normalizedSurname;
  }
  
  // Male surname declension rules for vocative case (5th case)
  if (gender === 'male') {
    const lowerSurname = normalizedSurname.toLowerCase();
    
    // 1. Surnames ending in -a (type "předseda") → -o
    if (lowerSurname.endsWith('a')) {
      const stem = normalizedSurname.slice(0, -1);
      const declined = stem + 'o';
      return preserveCapitalization(normalizedSurname, declined);
    }
    
    // 2. Surnames ending in k, g, h, ch (hard consonants) → -u
    const hardConsonantRules = [
      { ending: 'ák', replacement: 'áku' },
      { ending: 'ík', replacement: 'íku' },
      { ending: 'ék', replacement: 'éku' },
      { ending: 'ók', replacement: 'óku' },
      { ending: 'ůk', replacement: 'ůku' },
      { ending: 'uch', replacement: 'uchu' },
      { ending: 'ach', replacement: 'achu' },
      { ending: 'oh', replacement: 'ohu' },
      { ending: 'ah', replacement: 'ahu' },
    ];
    
    for (const rule of hardConsonantRules) {
      if (lowerSurname.endsWith(rule.ending)) {
        const stem = normalizedSurname.slice(0, -rule.ending.length);
        const declined = stem + rule.replacement;
        return preserveCapitalization(normalizedSurname, declined);
      }
    }
    
    // 3. Surnames with movable -e- (like -ec, -el)
    const movableERules = [
      // -ec surnames (drop movable e) → -če or -ci
      { ending: 'ec', replacement: 'če' },
      // -el surnames (can keep or drop e)
      { ending: 'el', replacement: 'le' }, // Most common: Menzel → Menzle
    ];
    
    for (const rule of movableERules) {
      if (lowerSurname.endsWith(rule.ending)) {
        const stem = normalizedSurname.slice(0, -rule.ending.length);
        const declined = stem + rule.replacement;
        return preserveCapitalization(normalizedSurname, declined);
      }
    }
    
    // 4. Surnames ending in soft consonants → -e (type "muž")
    const softConsonantRules = [
      { ending: 'š', replacement: 'ši' },
      { ending: 'ž', replacement: 'ži' },
      { ending: 'č', replacement: 'či' },
      { ending: 'ř', replacement: 'ři' },
      { ending: 'ň', replacement: 'ni' },
      { ending: 'ď', replacement: 'di' },
      { ending: 'ť', replacement: 'ti' },
      { ending: 'j', replacement: 'ji' },
      { ending: 'c', replacement: 'ci' },
    ];
    
    for (const rule of softConsonantRules) {
      if (lowerSurname.endsWith(rule.ending)) {
        const stem = normalizedSurname.slice(0, -rule.ending.length);
        const declined = stem + rule.replacement;
        return preserveCapitalization(normalizedSurname, declined);
      }
    }
    
    // 5. Adjective-type surnames (remain unchanged in vocative)
    const adjectiveEndings = ['ný', 'ský', 'cký', 'tský', 'dský'];
    for (const ending of adjectiveEndings) {
      if (lowerSurname.endsWith(ending)) {
        return normalizedSurname; // No change for adjective-type surnames
      }
    }
    
    // 6. Foreign surnames ending in -i, -y (pronominal type) → no change
    if (lowerSurname.endsWith('i') || lowerSurname.endsWith('y')) {
      return normalizedSurname; // No change for foreign names
    }
    
    // 7. Other hard consonants → -e (type "pán")
    const otherHardConsonants = ['b', 'f', 'l', 'm', 'p', 's', 'v', 'z', 'd', 'n', 'r', 't'];
    const lastChar = lowerSurname.slice(-1);
    
    if (otherHardConsonants.includes(lastChar)) {
      const declined = normalizedSurname + 'e';
      return declined;
    }
    
    // 8. Special cases and common surnames
    const specialCases = {
      // Common surnames with known vocative forms
      'novák': 'nováku',
      'svoboda': 'svobodo',
      'dvořák': 'dvořáku',
      'černý': 'černý',
      'procházka': 'procházko',
      'krejčí': 'krejčí',
      'horák': 'horáku',
      'němec': 'němče',
      'moravec': 'moravče',
      'urban': 'urbane',
      'fiala': 'fialo',
      'veselý': 'veselý',
      'pokorný': 'pokorný',
      'novotný': 'novotný',
      'štěpán': 'štěpáne',
      'jan': 'jane',
      'petr': 'petre',
      'pavel': 'pavle',
      'tomáš': 'tomáši',
      'jiří': 'jiří',
      'josef': 'josefe',
      'václav': 'václave',
      'martin': 'martine',
      'jaroslav': 'jaroslave',
      'miroslav': 'miroslave',
      'milan': 'milane',
      'karel': 'karle',
      'antonín': 'antoníne',
      'františek': 'františku',
      'david': 'davide',
      'daniel': 'danieli',
      'michal': 'michale',
      'lukáš': 'lukáši',
      'jakub': 'jakube',
      'ondřej': 'ondřeji',
      'adam': 'adame',
      'marek': 'marku',
      'patrik': 'patriku',
      'dominik': 'dominiku'
    };
    
    const specialCase = specialCases[lowerSurname];
    if (specialCase) {
      return preserveCapitalization(normalizedSurname, specialCase);
    }
  }
  
  // If no rule matches, return original surname (safest option)
  return normalizedSurname;
}

/**
 * Preserve the original capitalization pattern when applying declension
 * @param {string} original - The original surname
 * @param {string} declined - The declined surname
 * @returns {string} The declined surname with preserved capitalization
 */
function preserveCapitalization(original, declined) {
  if (!original || !declined) return declined;
  
  let result = '';
  for (let i = 0; i < declined.length; i++) {
    if (i < original.length) {
      // Copy case from original if possible
      if (original[i] === original[i].toUpperCase()) {
        result += declined[i].toUpperCase();
      } else {
        result += declined[i].toLowerCase();
      }
    } else {
      // For new characters, use lowercase
      result += declined[i].toLowerCase();
    }
  }
  
  return result;
}

/**
 * Generate appropriate Czech honorific based on gender
 * @param {string} gender - The gender ('male' or 'female')
 * @returns {string} The honorific ('pane' or 'paní')
 */
function getCzechHonorific(gender) {
  switch (gender) {
    case 'male':
      return 'pane';
    case 'female':
      return 'paní';
    default:
      return 'pane'; // Default to male form if unknown
  }
}

/**
 * Check if a surname is likely Czech based on common patterns
 * @param {string} surname - The surname to check
 * @returns {boolean} True if likely Czech
 */
function isLikelyCzechSurname(surname) {
  if (!surname) return false;
  
  const lowerSurname = surname.toLowerCase();
  const czechPatterns = [
    'ová', 'ák', 'ek', 'ný', 'ský', 'cký', 'ec', 'íček', 'oš', 'kí', 'ích'
  ];
  
  return czechPatterns.some(pattern => lowerSurname.endsWith(pattern));
}

module.exports = {
  declineSurnameToVocative,
  getCzechHonorific,
  isLikelyCzechSurname,
  preserveCapitalization
};