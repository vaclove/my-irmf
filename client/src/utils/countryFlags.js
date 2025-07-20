// Country code to flag mapping and utilities
export const getCountryFlag = (countryCode) => {
  if (!countryCode) return null;
  
  // Clean up the country code - handle multiple countries separated by commas or other delimiters
  const cleanCode = countryCode.trim().split(/[,;\/\s]+/)[0].toUpperCase();
  
  // Map of country codes to flag emojis
  const countryFlags = {
    // Common countries in festival data
    'CZ': '🇨🇿', // Czech Republic
    'SK': '🇸🇰', // Slovakia
    'DE': '🇩🇪', // Germany
    'FR': '🇫🇷', // France
    'IT': '🇮🇹', // Italy
    'ES': '🇪🇸', // Spain
    'PT': '🇵🇹', // Portugal
    'GB': '🇬🇧', // United Kingdom
    'UK': '🇬🇧', // United Kingdom (alternative)
    'US': '🇺🇸', // United States
    'CA': '🇨🇦', // Canada
    'RU': '🇷🇺', // Russia
    'PL': '🇵🇱', // Poland
    'HU': '🇭🇺', // Hungary
    'AT': '🇦🇹', // Austria
    'CH': '🇨🇭', // Switzerland
    'NL': '🇳🇱', // Netherlands
    'BE': '🇧🇪', // Belgium
    'NO': '🇳🇴', // Norway
    'SE': '🇸🇪', // Sweden
    'DK': '🇩🇰', // Denmark
    'FI': '🇫🇮', // Finland
    'IS': '🇮🇸', // Iceland
    'IE': '🇮🇪', // Ireland
    'LU': '🇱🇺', // Luxembourg
    'MC': '🇲🇨', // Monaco
    'MT': '🇲🇹', // Malta
    'CY': '🇨🇾', // Cyprus
    'GR': '🇬🇷', // Greece
    'TR': '🇹🇷', // Turkey
    'BG': '🇧🇬', // Bulgaria
    'RO': '🇷🇴', // Romania
    'HR': '🇭🇷', // Croatia
    'SI': '🇸🇮', // Slovenia
    'BA': '🇧🇦', // Bosnia and Herzegovina
    'RS': '🇷🇸', // Serbia
    'ME': '🇲🇪', // Montenegro
    'MK': '🇲🇰', // North Macedonia
    'AL': '🇦🇱', // Albania
    'LV': '🇱🇻', // Latvia
    'LT': '🇱🇹', // Lithuania
    'EE': '🇪🇪', // Estonia
    'BY': '🇧🇾', // Belarus
    'UA': '🇺🇦', // Ukraine
    'MD': '🇲🇩', // Moldova
    'GE': '🇬🇪', // Georgia
    'AM': '🇦🇲', // Armenia
    'AZ': '🇦🇿', // Azerbaijan
    'KZ': '🇰🇿', // Kazakhstan
    'UZ': '🇺🇿', // Uzbekistan
    'TM': '🇹🇲', // Turkmenistan
    'KG': '🇰🇬', // Kyrgyzstan
    'TJ': '🇹🇯', // Tajikistan
    'MN': '🇲🇳', // Mongolia
    'CN': '🇨🇳', // China
    'JP': '🇯🇵', // Japan
    'KR': '🇰🇷', // South Korea
    'KP': '🇰🇵', // North Korea
    'IN': '🇮🇳', // India
    'PK': '🇵🇰', // Pakistan
    'BD': '🇧🇩', // Bangladesh
    'LK': '🇱🇰', // Sri Lanka
    'NP': '🇳🇵', // Nepal
    'BT': '🇧🇹', // Bhutan
    'MV': '🇲🇻', // Maldives
    'AF': '🇦🇫', // Afghanistan
    'IR': '🇮🇷', // Iran
    'IQ': '🇮🇶', // Iraq
    'SY': '🇸🇾', // Syria
    'LB': '🇱🇧', // Lebanon
    'JO': '🇯🇴', // Jordan
    'IL': '🇮🇱', // Israel
    'PS': '🇵🇸', // Palestine
    'SA': '🇸🇦', // Saudi Arabia
    'AE': '🇦🇪', // United Arab Emirates
    'QA': '🇶🇦', // Qatar
    'BH': '🇧🇭', // Bahrain
    'KW': '🇰🇼', // Kuwait
    'OM': '🇴🇲', // Oman
    'YE': '🇾🇪', // Yemen
    'EG': '🇪🇬', // Egypt
    'LY': '🇱🇾', // Libya
    'TN': '🇹🇳', // Tunisia
    'DZ': '🇩🇿', // Algeria
    'MA': '🇲🇦', // Morocco
    'SD': '🇸🇩', // Sudan
    'SS': '🇸🇸', // South Sudan
    'ET': '🇪🇹', // Ethiopia
    'ER': '🇪🇷', // Eritrea
    'DJ': '🇩🇯', // Djibouti
    'SO': '🇸🇴', // Somalia
    'KE': '🇰🇪', // Kenya
    'UG': '🇺🇬', // Uganda
    'TZ': '🇹🇿', // Tanzania
    'RW': '🇷🇼', // Rwanda
    'BI': '🇧🇮', // Burundi
    'MG': '🇲🇬', // Madagascar
    'MU': '🇲🇺', // Mauritius
    'SC': '🇸🇨', // Seychelles
    'KM': '🇰🇲', // Comoros
    'ZA': '🇿🇦', // South Africa
    'NA': '🇳🇦', // Namibia
    'BW': '🇧🇼', // Botswana
    'ZW': '🇿🇼', // Zimbabwe
    'ZM': '🇿🇲', // Zambia
    'MW': '🇲🇼', // Malawi
    'MZ': '🇲🇿', // Mozambique
    'SZ': '🇸🇿', // Eswatini
    'LS': '🇱🇸', // Lesotho
    'AO': '🇦🇴', // Angola
    'CD': '🇨🇩', // Democratic Republic of Congo
    'CG': '🇨🇬', // Republic of Congo
    'CF': '🇨🇫', // Central African Republic
    'TD': '🇹🇩', // Chad
    'CM': '🇨🇲', // Cameroon
    'GQ': '🇬🇶', // Equatorial Guinea
    'GA': '🇬🇦', // Gabon
    'ST': '🇸🇹', // São Tomé and Príncipe
    'NG': '🇳🇬', // Nigeria
    'NE': '🇳🇪', // Niger
    'BF': '🇧🇫', // Burkina Faso
    'ML': '🇲🇱', // Mali
    'SN': '🇸🇳', // Senegal
    'MR': '🇲🇷', // Mauritania
    'GM': '🇬🇲', // Gambia
    'GW': '🇬🇼', // Guinea-Bissau
    'GN': '🇬🇳', // Guinea
    'SL': '🇸🇱', // Sierra Leone
    'LR': '🇱🇷', // Liberia
    'CI': '🇨🇮', // Côte d'Ivoire
    'GH': '🇬🇭', // Ghana
    'TG': '🇹🇬', // Togo
    'BJ': '🇧🇯', // Benin
    'CV': '🇨🇻', // Cape Verde
    'AU': '🇦🇺', // Australia
    'NZ': '🇳🇿', // New Zealand
    'FJ': '🇫🇯', // Fiji
    'PG': '🇵🇬', // Papua New Guinea
    'SB': '🇸🇧', // Solomon Islands
    'VU': '🇻🇺', // Vanuatu
    'NC': '🇳🇨', // New Caledonia
    'PF': '🇵🇫', // French Polynesia
    'AS': '🇦🇸', // American Samoa
    'GU': '🇬🇺', // Guam
    'MP': '🇲🇵', // Northern Mariana Islands
    'PW': '🇵🇼', // Palau
    'FM': '🇫🇲', // Micronesia
    'MH': '🇲🇭', // Marshall Islands
    'KI': '🇰🇮', // Kiribati
    'NR': '🇳🇷', // Nauru
    'TO': '🇹🇴', // Tonga
    'WS': '🇼🇸', // Samoa
    'TV': '🇹🇻', // Tuvalu
    'CL': '🇨🇱', // Chile
    'AR': '🇦🇷', // Argentina
    'UY': '🇺🇾', // Uruguay
    'PY': '🇵🇾', // Paraguay
    'BO': '🇧🇴', // Bolivia
    'PE': '🇵🇪', // Peru
    'EC': '🇪🇨', // Ecuador
    'CO': '🇨🇴', // Colombia
    'VE': '🇻🇪', // Venezuela
    'GY': '🇬🇾', // Guyana
    'SR': '🇸🇷', // Suriname
    'GF': '🇬🇫', // French Guiana
    'BR': '🇧🇷', // Brazil
    'MX': '🇲🇽', // Mexico
    'GT': '🇬🇹', // Guatemala
    'BZ': '🇧🇿', // Belize
    'SV': '🇸🇻', // El Salvador
    'HN': '🇭🇳', // Honduras
    'NI': '🇳🇮', // Nicaragua
    'CR': '🇨🇷', // Costa Rica
    'PA': '🇵🇦', // Panama
    'CU': '🇨🇺', // Cuba
    'JM': '🇯🇲', // Jamaica
    'HT': '🇭🇹', // Haiti
    'DO': '🇩🇴', // Dominican Republic
    'PR': '🇵🇷', // Puerto Rico
    'VI': '🇻🇮', // U.S. Virgin Islands
    'BM': '🇧🇲', // Bermuda
    'BS': '🇧🇸', // Bahamas
    'TT': '🇹🇹', // Trinidad and Tobago
    'BB': '🇧🇧', // Barbados
    'LC': '🇱🇨', // Saint Lucia
    'VC': '🇻🇨', // Saint Vincent and the Grenadines
    'GD': '🇬🇩', // Grenada
    'DM': '🇩🇲', // Dominica
    'AG': '🇦🇬', // Antigua and Barbuda
    'KN': '🇰🇳', // Saint Kitts and Nevis
    'AW': '🇦🇼', // Aruba
    'CW': '🇨🇼', // Curaçao
    'BQ': '🇧🇶', // Caribbean Netherlands
    'SX': '🇸🇽', // Sint Maarten
    'MF': '🇲🇫', // Saint Martin
    'GP': '🇬🇵', // Guadeloupe
    'MQ': '🇲🇶', // Martinique
    'BL': '🇧🇱', // Saint Barthélemy
    'PM': '🇵🇲', // Saint Pierre and Miquelon
    'GL': '🇬🇱', // Greenland
    'FO': '🇫🇴', // Faroe Islands
    'IM': '🇮🇲', // Isle of Man
    'JE': '🇯🇪', // Jersey
    'GG': '🇬🇬', // Guernsey
    'GI': '🇬🇮', // Gibraltar
    'AD': '🇦🇩', // Andorra
    'LI': '🇱🇮', // Liechtenstein
    'SM': '🇸🇲', // San Marino
    'VA': '🇻🇦', // Vatican City
    'WF': '🇼🇫', // Wallis and Futuna
    'YT': '🇾🇹', // Mayotte
    'RE': '🇷🇪', // Réunion
    'SH': '🇸🇭', // Saint Helena
    'AC': '🇦🇨', // Ascension Island
    'TA': '🇹🇦', // Tristan da Cunha
    'FK': '🇫🇰', // Falkland Islands
    'GS': '🇬🇸', // South Georgia and the South Sandwich Islands
    'TF': '🇹🇫', // French Southern Territories
    'HM': '🇭🇲', // Heard Island and McDonald Islands
    'CC': '🇨🇨', // Cocos (Keeling) Islands
    'CX': '🇨🇽', // Christmas Island
    'NF': '🇳🇫', // Norfolk Island
    'PN': '🇵🇳', // Pitcairn Islands
    'CK': '🇨🇰', // Cook Islands
    'NU': '🇳🇺', // Niue
    'TK': '🇹🇰', // Tokelau
    'BV': '🇧🇻', // Bouvet Island
    'SJ': '🇸🇯', // Svalbard and Jan Mayen
    'AX': '🇦🇽', // Åland Islands
  };
  
  return countryFlags[cleanCode] || null;
};

// Map of country codes to country names
const countryNames = {
  // Common countries in festival data
  'CZ': 'Czech Republic',
  'SK': 'Slovakia',
  'DE': 'Germany',
  'FR': 'France',
  'IT': 'Italy',
  'ES': 'Spain',
  'PT': 'Portugal',
  'GB': 'United Kingdom',
  'UK': 'United Kingdom',
  'US': 'United States',
  'CA': 'Canada',
  'RU': 'Russia',
  'PL': 'Poland',
  'HU': 'Hungary',
  'AT': 'Austria',
  'CH': 'Switzerland',
  'NL': 'Netherlands',
  'BE': 'Belgium',
  'NO': 'Norway',
  'SE': 'Sweden',
  'DK': 'Denmark',
  'FI': 'Finland',
  'IS': 'Iceland',
  'IE': 'Ireland',
  'LU': 'Luxembourg',
  'MC': 'Monaco',
  'MT': 'Malta',
  'CY': 'Cyprus',
  'GR': 'Greece',
  'TR': 'Turkey',
  'BG': 'Bulgaria',
  'RO': 'Romania',
  'HR': 'Croatia',
  'SI': 'Slovenia',
  'BA': 'Bosnia and Herzegovina',
  'RS': 'Serbia',
  'ME': 'Montenegro',
  'MK': 'North Macedonia',
  'AL': 'Albania',
  'LV': 'Latvia',
  'LT': 'Lithuania',
  'EE': 'Estonia',
  'BY': 'Belarus',
  'UA': 'Ukraine',
  'MD': 'Moldova',
  'GE': 'Georgia',
  'AM': 'Armenia',
  'AZ': 'Azerbaijan',
  'KZ': 'Kazakhstan',
  'UZ': 'Uzbekistan',
  'TM': 'Turkmenistan',
  'KG': 'Kyrgyzstan',
  'TJ': 'Tajikistan',
  'MN': 'Mongolia',
  'CN': 'China',
  'JP': 'Japan',
  'KR': 'South Korea',
  'KP': 'North Korea',
  'IN': 'India',
  'PK': 'Pakistan',
  'BD': 'Bangladesh',
  'LK': 'Sri Lanka',
  'NP': 'Nepal',
  'BT': 'Bhutan',
  'MV': 'Maldives',
  'AF': 'Afghanistan',
  'IR': 'Iran',
  'IQ': 'Iraq',
  'SY': 'Syria',
  'LB': 'Lebanon',
  'JO': 'Jordan',
  'IL': 'Israel',
  'PS': 'Palestine',
  'SA': 'Saudi Arabia',
  'AE': 'United Arab Emirates',
  'QA': 'Qatar',
  'BH': 'Bahrain',
  'KW': 'Kuwait',
  'OM': 'Oman',
  'YE': 'Yemen',
  'EG': 'Egypt',
  'LY': 'Libya',
  'TN': 'Tunisia',
  'DZ': 'Algeria',
  'MA': 'Morocco',
  'SD': 'Sudan',
  'SS': 'South Sudan',
  'ET': 'Ethiopia',
  'ER': 'Eritrea',
  'DJ': 'Djibouti',
  'SO': 'Somalia',
  'KE': 'Kenya',
  'UG': 'Uganda',
  'TZ': 'Tanzania',
  'RW': 'Rwanda',
  'BI': 'Burundi',
  'MG': 'Madagascar',
  'MU': 'Mauritius',
  'SC': 'Seychelles',
  'KM': 'Comoros',
  'ZA': 'South Africa',
  'NA': 'Namibia',
  'BW': 'Botswana',
  'ZW': 'Zimbabwe',
  'ZM': 'Zambia',
  'MW': 'Malawi',
  'MZ': 'Mozambique',
  'SZ': 'Eswatini',
  'LS': 'Lesotho',
  'AO': 'Angola',
  'CD': 'Democratic Republic of Congo',
  'CG': 'Republic of Congo',
  'CF': 'Central African Republic',
  'TD': 'Chad',
  'CM': 'Cameroon',
  'GQ': 'Equatorial Guinea',
  'GA': 'Gabon',
  'ST': 'São Tomé and Príncipe',
  'NG': 'Nigeria',
  'NE': 'Niger',
  'BF': 'Burkina Faso',
  'ML': 'Mali',
  'SN': 'Senegal',
  'MR': 'Mauritania',
  'GM': 'Gambia',
  'GW': 'Guinea-Bissau',
  'GN': 'Guinea',
  'SL': 'Sierra Leone',
  'LR': 'Liberia',
  'CI': 'Côte d\'Ivoire',
  'GH': 'Ghana',
  'TG': 'Togo',
  'BJ': 'Benin',
  'CV': 'Cape Verde',
  'AU': 'Australia',
  'NZ': 'New Zealand',
  'FJ': 'Fiji',
  'PG': 'Papua New Guinea',
  'SB': 'Solomon Islands',
  'VU': 'Vanuatu',
  'NC': 'New Caledonia',
  'PF': 'French Polynesia',
  'AS': 'American Samoa',
  'GU': 'Guam',
  'MP': 'Northern Mariana Islands',
  'PW': 'Palau',
  'FM': 'Micronesia',
  'MH': 'Marshall Islands',
  'KI': 'Kiribati',
  'NR': 'Nauru',
  'TO': 'Tonga',
  'WS': 'Samoa',
  'TV': 'Tuvalu',
  'CL': 'Chile',
  'AR': 'Argentina',
  'UY': 'Uruguay',
  'PY': 'Paraguay',
  'BO': 'Bolivia',
  'PE': 'Peru',
  'EC': 'Ecuador',
  'CO': 'Colombia',
  'VE': 'Venezuela',
  'GY': 'Guyana',
  'SR': 'Suriname',
  'GF': 'French Guiana',
  'BR': 'Brazil',
  'MX': 'Mexico',
  'GT': 'Guatemala',
  'BZ': 'Belize',
  'SV': 'El Salvador',
  'HN': 'Honduras',
  'NI': 'Nicaragua',
  'CR': 'Costa Rica',
  'PA': 'Panama',
  'CU': 'Cuba',
  'JM': 'Jamaica',
  'HT': 'Haiti',
  'DO': 'Dominican Republic',
  'PR': 'Puerto Rico',
  'VI': 'U.S. Virgin Islands',
  'BM': 'Bermuda',
  'BS': 'Bahamas',
  'TT': 'Trinidad and Tobago',
  'BB': 'Barbados',
  'LC': 'Saint Lucia',
  'VC': 'Saint Vincent and the Grenadines',
  'GD': 'Grenada',
  'DM': 'Dominica',
  'AG': 'Antigua and Barbuda',
  'KN': 'Saint Kitts and Nevis',
  'AW': 'Aruba',
  'CW': 'Curaçao',
  'BQ': 'Caribbean Netherlands',
  'SX': 'Sint Maarten',
  'MF': 'Saint Martin',
  'GP': 'Guadeloupe',
  'MQ': 'Martinique',
  'BL': 'Saint Barthélemy',
  'PM': 'Saint Pierre and Miquelon',
  'GL': 'Greenland',
  'FO': 'Faroe Islands',
  'IM': 'Isle of Man',
  'JE': 'Jersey',
  'GG': 'Guernsey',
  'GI': 'Gibraltar',
  'AD': 'Andorra',
  'LI': 'Liechtenstein',
  'SM': 'San Marino',
  'VA': 'Vatican City',
  'WF': 'Wallis and Futuna',
  'YT': 'Mayotte',
  'RE': 'Réunion',
  'SH': 'Saint Helena',
  'AC': 'Ascension Island',
  'TA': 'Tristan da Cunha',
  'FK': 'Falkland Islands',
  'GS': 'South Georgia and the South Sandwich Islands',
  'TF': 'French Southern Territories',
  'HM': 'Heard Island and McDonald Islands',
  'CC': 'Cocos (Keeling) Islands',
  'CX': 'Christmas Island',
  'NF': 'Norfolk Island',
  'PN': 'Pitcairn Islands',
  'CK': 'Cook Islands',
  'NU': 'Niue',
  'TK': 'Tokelau',
  'BV': 'Bouvet Island',
  'SJ': 'Svalbard and Jan Mayen',
  'AX': 'Åland Islands',
};

// Get country name from country code
export const getCountryName = (countryCode) => {
  if (!countryCode) return null;
  const cleanCode = countryCode.trim().toUpperCase();
  return countryNames[cleanCode] || cleanCode;
};

// Get multiple country flags for comma-separated country codes
export const getCountryFlags = (countryCode) => {
  if (!countryCode) return [];
  
  // Split by various delimiters and clean up
  const codes = countryCode.split(/[,;\/\s]+/)
    .map(code => code.trim())
    .filter(code => code.length > 0);
  
  return codes.map(code => ({
    code: code.toUpperCase(),
    flag: getCountryFlag(code),
    name: getCountryName(code),
    original: code
  })).filter(item => item.flag); // Only return items with valid flags
};

// Format country display with flags
export const formatCountryWithFlags = (countryCode) => {
  if (!countryCode) return null;
  
  const countries = getCountryFlags(countryCode);
  
  if (countries.length === 0) {
    return { 
      text: countryCode, 
      flags: [], 
      countries: [{ code: countryCode, flag: null, name: countryCode, original: countryCode }],
      isMultiple: false
    };
  }
  
  if (countries.length === 1) {
    return {
      text: countries[0].code,
      flags: [countries[0].flag],
      countries: countries,
      display: `${countries[0].flag} ${countries[0].code}`,
      isMultiple: false
    };
  }
  
  // Multiple countries
  const flags = countries.map(c => c.flag).join('');
  const codes = countries.map(c => c.code).join(', ');
  
  return {
    text: codes,
    flags: countries.map(c => c.flag),
    countries: countries,
    display: `${flags} ${codes}`,
    isMultiple: true
  };
};