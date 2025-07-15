// Gender detection utility for greeting generation
// Based on common name patterns for English and Czech names

const maleNames = new Set([
  // English male names (common ones)
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'charles', 'joseph', 'thomas',
  'christopher', 'daniel', 'paul', 'mark', 'donald', 'steven', 'andrew', 'kenneth', 'joshua', 'kevin',
  'brian', 'george', 'timothy', 'ronald', 'jason', 'edward', 'jeffrey', 'ryan', 'jacob', 'gary',
  'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon', 'benjamin', 'samuel',
  
  // Czech male names (common ones)
  'jan', 'petr', 'josef', 'pavel', 'tomáš', 'jaroslav', 'martin', 'miroslav', 'jiří', 'václav',
  'zdeněk', 'stanislav', 'karel', 'vladimír', 'jakub', 'františek', 'milan', 'lubomír', 'ondřej', 'michal',
  'daniel', 'david', 'adam', 'lukáš', 'marek', 'roman', 'vojtěch', 'antonín', 'radek', 'aleš',
  'matěj', 'filip', 'patrik', 'šimon', 'dominik', 'richard', 'robert', 'marcel', 'nikolas', 'sebastián'
]);

const femaleNames = new Set([
  // English female names (common ones)
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica', 'sarah', 'karen',
  'nancy', 'lisa', 'betty', 'helen', 'sandra', 'donna', 'carol', 'ruth', 'sharon', 'michelle',
  'laura', 'sarah', 'kimberly', 'deborah', 'dorothy', 'lisa', 'nancy', 'karen', 'betty', 'helen',
  'sandra', 'donna', 'carol', 'ruth', 'sharon', 'michelle', 'laura', 'sarah', 'kimberly', 'deborah',
  
  // Czech female names (common ones)
  'marie', 'jana', 'eva', 'anna', 'věra', 'alena', 'lenka', 'kateřina', 'lucie', 'helena',
  'jitka', 'martina', 'zuzana', 'jaroslava', 'petra', 'božena', 'hana', 'jiřina', 'růžena', 'vlasta',
  'tereza', 'veronika', 'barbora', 'klára', 'adéla', 'natálie', 'nikola', 'kristýna', 'simona', 'michaela',
  'daniela', 'andrea', 'monika', 'ivana', 'šárka', 'marcela', 'renata', 'dagmar', 'zdenka', 'milada',
  'vladimíra', 'kamila', 'božena', 'ludmila', 'anežka', 'františka', 'olga', 'irena', 'libuše', 'emilie',
  'julie', 'radka', 'pavla', 'věra', 'gabriela', 'jarmila', 'silva', 'naděžda', 'stanislava', 'blanka'
]);

// Czech surname patterns for gender detection
const czechMaleSurnameEndings = [
  'ák', 'ek', 'ík', 'ný', 'ský', 'cký', 'ec', 'an', 'el', 'os', 'ur', 'ej'
];

const czechFemaleSurnameEndings = [
  'ová', 'ná', 'ská', 'cká'
];

/**
 * Detect gender based on first name and optional surname
 * @param {string} firstName - The first name
 * @param {string} lastName - The last name (optional, used for Czech detection)
 * @param {string} language - Language context ('english' or 'czech')
 * @returns {string|null} 'male', 'female', or null if unknown
 */
function detectGender(firstName, lastName = '', language = 'english') {
  if (!firstName) return null;
  
  const normalizedFirstName = firstName.toLowerCase().trim();
  
  // Check first name against known names
  if (maleNames.has(normalizedFirstName)) {
    return 'male';
  }
  
  if (femaleNames.has(normalizedFirstName)) {
    return 'female';
  }
  
  // For Czech, also check surname patterns
  if (language === 'czech' && lastName) {
    const normalizedLastName = lastName.toLowerCase().trim();
    
    // Check female surname endings first (more specific)
    for (const ending of czechFemaleSurnameEndings) {
      if (normalizedLastName.endsWith(ending)) {
        return 'female';
      }
    }
    
    // Check male surname endings
    for (const ending of czechMaleSurnameEndings) {
      if (normalizedLastName.endsWith(ending)) {
        return 'male';
      }
    }
  }
  
  // Check common name endings for additional hints
  if (language === 'czech') {
    // Czech name ending patterns
    // Most Czech female names end with 'a', with few exceptions
    if (normalizedFirstName.endsWith('a')) {
      // Exceptions: some male names also end with 'a' (e.g., 'tomáša' in genitive, but 'tomáš' in nominative)
      // Common male exceptions: none in nominative case for first names
      return 'female';
    }
    // Names ending with 'e' are often female (e.g., Marie, but check length)
    if (normalizedFirstName.endsWith('e') && normalizedFirstName.length > 3) {
      return 'female';
    }
    // Names ending with 'ie' are typically female
    if (normalizedFirstName.endsWith('ie')) {
      return 'female';
    }
  } else {
    // English name ending patterns (less reliable)
    if (normalizedFirstName.endsWith('a') || normalizedFirstName.endsWith('ia') || 
        normalizedFirstName.endsWith('ina') || normalizedFirstName.endsWith('lyn')) {
      return 'female';
    }
  }
  
  return null; // Unknown gender
}

/**
 * Add a name to the gender database (for learning/customization)
 * @param {string} name - The name to add
 * @param {string} gender - The gender ('male' or 'female')
 */
function addNameToDatabase(name, gender) {
  const normalizedName = name.toLowerCase().trim();
  if (gender === 'male') {
    maleNames.add(normalizedName);
  } else if (gender === 'female') {
    femaleNames.add(normalizedName);
  }
}

module.exports = {
  detectGender,
  addNameToDatabase
};