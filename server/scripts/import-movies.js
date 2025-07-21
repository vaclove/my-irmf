require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../models/database');
const mysql = require('mysql2/promise');

// Configuration
const IMAGES_BASE_PATH = 'tmp/3/';
const SUPPORTED_IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const BATCH_SIZE = 100;

// Command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const resumeMode = args.includes('--resume');
const useMysql = args.includes('--mysql');
const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
const imagesDirArg = args.find(arg => arg.startsWith('--images-dir='));

const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : BATCH_SIZE;
const imagesBasePath = imagesDirArg ? imagesDirArg.split('=')[1] : IMAGES_BASE_PATH;

// MySQL connection configuration
const mysqlConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT) || 3307,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
};

// Statistics
const stats = {
  totalMovies: 0,
  imported: 0,
  skipped: 0,
  errors: 0,
  blobImages: 0,
  fileImages: 0,
  missingImages: 0,
  editionsCreated: 0,
  startTime: Date.now()
};

// Utility functions
function detectImageType(buffer) {
  const firstBytes = buffer.slice(0, 4);
  
  if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8) {
    return 'image/jpeg';
  } else if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) {
    return 'image/png';
  } else if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46) {
    return 'image/gif';
  } else if (firstBytes.toString('ascii', 0, 4) === 'RIFF') {
    return 'image/webp';
  }
  
  return 'image/jpeg'; // Default fallback
}

function detectImageTypeFromPath(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

function escapeSqlString(str) {
  if (!str) return null;
  return str.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

function parseValue(value, type = 'string') {
  if (value === 'NULL' || value === null || value === undefined) {
    return null;
  }
  
  // Remove surrounding quotes
  if (typeof value === 'string' && value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  
  switch (type) {
    case 'number':
      return value === '' ? null : parseInt(value, 10);
    case 'boolean':
      return value === '1' || value === 'true';
    default:
      return value === '' ? null : value;
  }
}

// Parse MySQL INSERT statements - Improved parser for real movie data
function parseMoviesFromDump(dumpContent) {
  console.log('📖 Parsing MySQL dump file...');
  
  const movies = [];
  
  // Find the INSERT statement for _movies table
  const insertStart = dumpContent.indexOf('INSERT INTO `_movies` VALUES');
  const insertEnd = dumpContent.indexOf(';', insertStart);
  
  if (insertStart === -1 || insertEnd === -1) {
    console.warn('⚠️  No complete INSERT statement found for _movies table');
    return movies;
  }
  
  const insertStatement = dumpContent.substring(insertStart, insertEnd);
  console.log(`📊 Found INSERT statement (${insertStatement.length} characters)`);
  
  // Extract the values part
  const valuesStart = insertStatement.indexOf('VALUES ') + 7;
  const valuesString = insertStatement.substring(valuesStart);
  
  // Parse movies using a more sophisticated approach
  // We need to handle the complex structure with binary data
  let currentPos = 0;
  let rowCount = 0;
  
  while (currentPos < valuesString.length) {
    // Find the start of the next row: (
    const rowStart = valuesString.indexOf('(', currentPos);
    if (rowStart === -1) break;
    
    try {
      // Parse this specific row
      const movie = parseMovieRowAdvanced(valuesString, rowStart);
      if (movie) {
        movies.push(movie);
        rowCount++;
        
        if (rowCount % 500 === 0) {
          console.log(`📊 Parsed ${rowCount} movies...`);
        }
      }
      
      // Find the end of this row by looking for the closing paren followed by comma or end
      // This is tricky due to binary data, so we'll search carefully
      currentPos = findRowEnd(valuesString, rowStart);
      
    } catch (error) {
      console.warn(`⚠️  Failed to parse row ${rowCount + 1}: ${error.message}`);
      stats.errors++;
      
      // Try to skip to next potential row start
      currentPos = valuesString.indexOf('(', currentPos + 1);
      if (currentPos === -1) break;
    }
  }
  
  console.log(`✅ Parsed ${movies.length} movie records from dump file`);
  stats.totalMovies = movies.length;
  return movies;
}

// Parse movies from TSV file - much simpler and more reliable
function parseMoviesFromTSV(tsvContent) {
  console.log('📖 Parsing TSV file...');
  
  const movies = [];
  const lines = tsvContent.split('\n');
  
  console.log(`📊 Found ${lines.length} lines in TSV file`);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines
    
    try {
      const columns = line.split('\t');
      
      // Ensure we have the expected number of columns (18)
      if (columns.length < 18) {
        console.warn(`⚠️  Row ${i + 1}: Expected 18 columns, got ${columns.length}. Skipping.`);
        continue;
      }
      
      const movie = {
        mysql_id: parseInt(columns[0]) || null,
        catalogue_year: columns[1] || null,
        name_cs: columns[2] || null,
        name_en: columns[3] || null,
        synopsis_cs: columns[4] || null,
        synopsis_en: columns[5] || null,
        fulltext_cs: columns[6] || null,
        image: columns[7] || null,
        image_blob: columns[8] || null, // Binary data as string
        runtime: columns[9] || null,
        director: columns[10] || null,
        year: parseInt(columns[11]) || null,
        country: columns[12] || null,
        cast: columns[13] || null,
        premiere: columns[14] || null,
        section: columns[15] || null,
        is_35mm: columns[16] === '1',
        has_delegation: columns[17] === '1'
      };
      
      // Use synopsis_cs as fallback for fulltext_cs if missing
      if (!movie.fulltext_cs && movie.synopsis_cs) {
        movie.fulltext_cs = movie.synopsis_cs;
      }
      
      // Validate required fields
      if (!movie.mysql_id || !movie.name_cs || !movie.fulltext_cs) {
        console.warn(`⚠️  Row ${i + 1}: Missing required fields (id: ${!!movie.mysql_id}, name_cs: ${!!movie.name_cs}, fulltext_cs: ${!!movie.fulltext_cs}). Skipping.`);
        continue;
      }
      
      movies.push(movie);
      
      if (movies.length % 500 === 0) {
        console.log(`📊 Parsed ${movies.length} movies...`);
      }
      
    } catch (error) {
      console.warn(`⚠️  Failed to parse row ${i + 1}: ${error.message}`);
      stats.errors++;
    }
  }
  
  console.log(`✅ Parsed ${movies.length} movie records from TSV file`);
  stats.totalMovies = movies.length;
  return movies;
}

// Fetch movies directly from MySQL database
async function fetchMoviesFromMySQL() {
  console.log('🔌 Connecting to MySQL database...');
  
  let connection;
  try {
    // Create MySQL connection
    connection = await mysql.createConnection(mysqlConfig);
    console.log('✅ MySQL connection established');
    
    // Get total count first
    const [countResult] = await connection.execute('SELECT COUNT(*) as total FROM _movies');
    const totalCount = countResult[0].total;
    console.log(`📊 Found ${totalCount} movies in MySQL database`);
    
    // Fetch all movies in batches for better memory management
    const movies = [];
    const fetchBatchSize = 1000; // Fetch in chunks of 1000
    
    for (let offset = 0; offset < totalCount; offset += fetchBatchSize) {
      console.log(`📥 Fetching movies ${offset + 1}-${Math.min(offset + fetchBatchSize, totalCount)}...`);
      
      const [rows] = await connection.execute(`
        SELECT 
          id as mysql_id,
          catalogue_year,
          name_cs,
          name_en,
          synopsis_cs,
          synopsis_en,
          fulltext_cs,
          image,
          image_blob,
          runtime,
          director,
          year,
          country,
          \`cast\`,
          premiere,
          section,
          35mm as is_35mm,
          delegation as has_delegation
        FROM _movies 
        ORDER BY id
        LIMIT ? OFFSET ?
      `, [fetchBatchSize, offset]);
      
      // Process each row
      for (const row of rows) {
        const movie = {
          mysql_id: row.mysql_id,
          catalogue_year: row.catalogue_year,
          name_cs: row.name_cs,
          name_en: row.name_en,
          synopsis_cs: row.synopsis_cs,
          synopsis_en: row.synopsis_en,
          fulltext_cs: row.fulltext_cs,
          image: row.image,
          image_blob: row.image_blob, // This will be a Buffer for binary data
          runtime: row.runtime,
          director: row.director,
          year: row.year,
          country: row.country,
          cast: row.cast,
          premiere: row.premiere,
          section: row.section,
          is_35mm: Boolean(row.is_35mm),
          has_delegation: Boolean(row.has_delegation)
        };
        
        // Use synopsis_cs as fallback for fulltext_cs if missing
        if (!movie.fulltext_cs && movie.synopsis_cs) {
          movie.fulltext_cs = movie.synopsis_cs;
        }
        
        // Validate required fields
        if (!movie.mysql_id || !movie.name_cs || !movie.fulltext_cs) {
          console.warn(`⚠️  Skipping movie ${movie.mysql_id}: Missing required fields (id: ${!!movie.mysql_id}, name_cs: ${!!movie.name_cs}, fulltext_cs: ${!!movie.fulltext_cs})`);
          continue;
        }
        
        movies.push(movie);
      }
    }
    
    console.log(`✅ Fetched ${movies.length} movie records from MySQL`);
    stats.totalMovies = movies.length;
    return movies;
    
  } catch (error) {
    console.error(`❌ MySQL connection failed: ${error.message}`);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 MySQL connection closed');
    }
  }
}

// Parse a single movie row from the INSERT statement
function parseMovieRowAdvanced(valuesString, startPos) {
  // Extract fields one by one, handling quotes and binary data carefully
  let pos = startPos + 1; // Skip opening paren
  const fields = [];
  
  // Field 1: id (integer)
  const idMatch = valuesString.substring(pos).match(/^(\d+),/);
  if (!idMatch) return null;
  
  const mysql_id = parseInt(idMatch[1]);
  pos += idMatch[0].length;
  
  // Field 2: catalogue_year (quoted string or null)
  const yearField = extractField(valuesString, pos);
  if (!yearField) return null;
  const catalogue_year = parseValue(yearField.value);
  pos = yearField.nextPos;
  
  // Field 3: name_cs (quoted string)
  const nameCsField = extractField(valuesString, pos);
  if (!nameCsField) return null;
  const name_cs = parseValue(nameCsField.value);
  pos = nameCsField.nextPos;
  
  // Field 4: name_en (quoted string or null)
  const nameEnField = extractField(valuesString, pos);
  if (!nameEnField) return null;
  const name_en = parseValue(nameEnField.value);
  pos = nameEnField.nextPos;
  
  // Field 5: synopsis_cs (quoted string or null)
  const synopsisCsField = extractField(valuesString, pos);
  if (!synopsisCsField) return null;
  const synopsis_cs = parseValue(synopsisCsField.value);
  pos = synopsisCsField.nextPos;
  
  // Field 6: synopsis_en (quoted string or null)
  const synopsisEnField = extractField(valuesString, pos);
  if (!synopsisEnField) return null;
  const synopsis_en = parseValue(synopsisEnField.value);
  pos = synopsisEnField.nextPos;
  
  // Field 7: fulltext_cs (quoted string)
  const fulltextField = extractField(valuesString, pos);
  if (!fulltextField) return null;
  const fulltext_cs = parseValue(fulltextField.value);
  pos = fulltextField.nextPos;
  
  // Field 8: image (quoted string)
  const imageField = extractField(valuesString, pos);
  if (!imageField) return null;
  const image = parseValue(imageField.value);
  pos = imageField.nextPos;
  
  // Field 9: image_blob (binary data or NULL) - this is complex, we'll skip extraction for now
  const blobField = extractBinaryField(valuesString, pos);
  if (!blobField) return null;
  const image_blob = blobField.value; // Keep as string for now
  pos = blobField.nextPos;
  
  // Continue with remaining fields (runtime, director, year, country, cast, premiere, section, 35mm, delegation)
  const remainingFields = [];
  for (let i = 0; i < 9; i++) {
    const field = extractField(valuesString, pos);
    if (!field) return null;
    remainingFields.push(parseValue(field.value));
    pos = field.nextPos;
  }
  
  return {
    mysql_id: mysql_id,
    catalogue_year: catalogue_year,
    name_cs: name_cs,
    name_en: name_en,
    synopsis_cs: synopsis_cs,
    synopsis_en: synopsis_en,
    fulltext_cs: fulltext_cs,
    image: image,
    image_blob: image_blob,
    runtime: remainingFields[0],
    director: remainingFields[1],
    year: parseValue(remainingFields[2], 'number'),
    country: remainingFields[3],
    cast: remainingFields[4],
    premiere: remainingFields[5],
    section: remainingFields[6],
    is_35mm: parseValue(remainingFields[7], 'boolean'),
    has_delegation: parseValue(remainingFields[8], 'boolean')
  };
}

// Parse individual movie row (legacy method)
function parseMovieRow(row) {
  if (row.length < 18) {
    throw new Error(`Row has ${row.length} columns, expected 18`);
  }
  
  return {
    mysql_id: parseValue(row[0], 'number'),
    catalogue_year: parseValue(row[1]),
    name_cs: parseValue(row[2]),
    name_en: parseValue(row[3]),
    synopsis_cs: parseValue(row[4]),
    synopsis_en: parseValue(row[5]),
    fulltext_cs: parseValue(row[6]),
    image: parseValue(row[7]),
    image_blob: row[8] === 'NULL' ? null : row[8], // Handle binary data as string for now
    runtime: parseValue(row[9]),
    director: parseValue(row[10]),
    year: parseValue(row[11], 'number'),
    country: parseValue(row[12]),
    cast: parseValue(row[13]),
    premiere: parseValue(row[14]),
    section: parseValue(row[15]),
    is_35mm: parseValue(row[16], 'boolean'),
    has_delegation: parseValue(row[17], 'boolean')
  };
}

// Extract a field (quoted string, number, or NULL) and return value + next position
function extractField(str, pos) {
  // Skip any whitespace
  while (pos < str.length && /\s/.test(str[pos])) pos++;
  
  if (pos >= str.length) return null;
  
  // Check for NULL
  if (str.substring(pos, pos + 4) === 'NULL') {
    const nextComma = str.indexOf(',', pos + 4);
    return {
      value: 'NULL',
      nextPos: nextComma + 1
    };
  }
  
  // Check for quoted string
  if (str[pos] === "'") {
    return extractQuotedString(str, pos);
  }
  
  // Must be an unquoted value (number, etc)
  const nextComma = str.indexOf(',', pos);
  const nextParen = str.indexOf(')', pos);
  const endPos = Math.min(
    nextComma === -1 ? Infinity : nextComma,
    nextParen === -1 ? Infinity : nextParen
  );
  
  if (endPos === Infinity) return null;
  
  return {
    value: str.substring(pos, endPos).trim(),
    nextPos: nextComma !== -1 && nextComma < nextParen ? nextComma + 1 : endPos
  };
}

// Extract a quoted string, handling escaped quotes
function extractQuotedString(str, pos) {
  if (str[pos] !== "'") return null;
  
  let endPos = pos + 1;
  let value = '';
  
  while (endPos < str.length) {
    const char = str[endPos];
    
    if (char === "'") {
      // Check if it's escaped
      if (endPos + 1 < str.length && str[endPos + 1] === "'") {
        // Escaped quote
        value += "'";
        endPos += 2;
      } else {
        // End of string
        endPos++;
        break;
      }
    } else if (char === "\\") {
      // Handle backslash escapes
      if (endPos + 1 < str.length) {
        const nextChar = str[endPos + 1];
        switch (nextChar) {
          case 'n': value += '\n'; break;
          case 'r': value += '\r'; break;
          case 't': value += '\t'; break;
          case '\\': value += '\\'; break;
          case "'": value += "'"; break;
          default: value += nextChar; break;
        }
        endPos += 2;
      } else {
        value += char;
        endPos++;
      }
    } else {
      value += char;
      endPos++;
    }
  }
  
  // Find next comma
  const nextComma = str.indexOf(',', endPos);
  return {
    value: `'${value}'`,
    nextPos: nextComma === -1 ? endPos : nextComma + 1
  };
}

// Extract binary field (blob data) - simplified approach
function extractBinaryField(str, pos) {
  // Skip whitespace
  while (pos < str.length && /\s/.test(str[pos])) pos++;
  
  if (pos >= str.length) return null;
  
  // Check for NULL
  if (str.substring(pos, pos + 4) === 'NULL') {
    const nextComma = str.indexOf(',', pos + 4);
    return {
      value: null,
      nextPos: nextComma + 1
    };
  }
  
  // For binary data, we need to find the next field start
  // This is complex due to binary content, so we'll use a heuristic
  // Look for the pattern ,runtime field which should be next
  const nextComma = findNextFieldStart(str, pos);
  
  return {
    value: str.substring(pos, nextComma), // Keep binary data as string for now
    nextPos: nextComma + 1
  };
}

// Find the next field start after binary data
function findNextFieldStart(str, pos) {
  // Look for the pattern that indicates the runtime field (should be a quoted string like '120')
  // We'll search for ,'digit patterns that likely indicate the runtime field
  let searchPos = pos;
  
  while (searchPos < str.length) {
    const commaPos = str.indexOf(',', searchPos);
    if (commaPos === -1) break;
    
    // Check if this looks like the start of the runtime field
    const afterComma = commaPos + 1;
    // Skip whitespace
    while (afterComma < str.length && /\s/.test(str[afterComma])) {}
    
    // Check if next field looks like runtime ('120' or NULL)
    if (str.substring(afterComma, afterComma + 4) === 'NULL' ||
        (str[afterComma] === "'" && /'\d+/.test(str.substring(afterComma, afterComma + 5)))) {
      return commaPos;
    }
    
    searchPos = commaPos + 1;
  }
  
  return str.length;
}

// Find the end of a movie row
function findRowEnd(str, startPos) {
  // Look for ),( pattern or ) at end
  let pos = startPos + 1;
  let parenLevel = 1;
  
  while (pos < str.length && parenLevel > 0) {
    if (str[pos] === '(') {
      parenLevel++;
    } else if (str[pos] === ')') {
      parenLevel--;
    }
    pos++;
  }
  
  // Skip comma if present
  if (pos < str.length && str[pos] === ',') {
    pos++;
  }
  
  return pos;
}

// Simple CSV-like parser for MySQL values (legacy)
function parseRowValues(row) {
  const values = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < row.length) {
    const char = row[i];
    
    if (char === "'" && (i === 0 || row[i-1] !== '\\')) {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
    i++;
  }
  
  // Add the last value
  if (current.trim()) {
    values.push(current.trim());
  }
  
  return values;
}

// Process movie images
async function processMovieImage(movie) {
  try {
    // Scenario 1: Image blob data available (priority)
    if (movie.image_blob && movie.image_blob.length > 0) {
      let buffer;
      
      // Handle different blob formats
      if (Buffer.isBuffer(movie.image_blob)) {
        // Direct buffer from MySQL (when using mysql2)
        buffer = movie.image_blob;
      } else if (typeof movie.image_blob === 'string') {
        // String data from TSV or dump parsing
        // Remove quotes if present
        let blobData = movie.image_blob;
        if (blobData.startsWith("'") && blobData.endsWith("'")) {
          blobData = blobData.slice(1, -1);
        }
        
        // Try to decode as binary string (MySQL dump format)
        try {
          // Convert MySQL binary string to buffer
          const bytes = [];
          for (let i = 0; i < blobData.length; i++) {
            bytes.push(blobData.charCodeAt(i) & 0xFF);
          }
          buffer = Buffer.from(bytes);
        } catch (blobError) {
          console.warn(`⚠️  Failed to process blob data for movie ${movie.mysql_id}: ${blobError.message}`);
        }
      }
      
      // Validate and process the buffer if we have one
      if (buffer && buffer.length > 4) {
        const header = buffer.slice(0, 4);
        // Check for common image signatures
        if ((header[0] === 0xFF && header[1] === 0xD8) || // JPEG
            (header[0] === 0x89 && header[1] === 0x50) || // PNG
            (header[0] === 0x47 && header[1] === 0x49)) { // GIF
          
          const mimeType = detectImageType(buffer);
          movie.image_data = `data:${mimeType};base64,${buffer.toString('base64')}`;
          stats.blobImages++;
          return;
        }
      }
    }
    
    // Scenario 2: Image file path only (fallback)
    if (movie.image && movie.image.length > 0) {
      // Remove quotes from image path
      let imagePath = movie.image;
      if (imagePath.startsWith("'") && imagePath.endsWith("'")) {
        imagePath = imagePath.slice(1, -1);
      }
      
      const fullImagePath = path.join(imagesBasePath, imagePath);
      
      if (fs.existsSync(fullImagePath)) {
        const imageBuffer = fs.readFileSync(fullImagePath);
        const mimeType = detectImageTypeFromPath(imagePath);
        movie.image_data = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
        stats.fileImages++;
        return;
      } else {
        console.warn(`⚠️  Image file not found: ${fullImagePath}`);
      }
    }
    
    // No image available
    movie.image_data = null;
    stats.missingImages++;
    
  } catch (error) {
    console.error(`❌ Failed to process image for movie ${movie.mysql_id}: ${error.message}`);
    movie.image_data = null;
    stats.missingImages++;
  }
}

// Create edition if it doesn't exist
async function ensureEditionExists(catalogueYear) {
  if (!catalogueYear) return null;
  
  try {
    // Check if edition exists
    const existingEdition = await pool.query(
      'SELECT id FROM editions WHERE year = $1',
      [parseInt(catalogueYear)]
    );
    
    if (existingEdition.rows.length > 0) {
      return existingEdition.rows[0].id;
    }
    
    // Create new edition
    const newEdition = await pool.query(
      'INSERT INTO editions (year, name) VALUES ($1, $2) RETURNING id',
      [parseInt(catalogueYear), `IRMF ${catalogueYear}`]
    );
    
    console.log(`✅ Created new edition: IRMF ${catalogueYear}`);
    stats.editionsCreated++;
    return newEdition.rows[0].id;
    
  } catch (error) {
    console.error(`❌ Failed to create edition for year ${catalogueYear}: ${error.message}`);
    return null;
  }
}

// Check if movie already exists
async function movieExists(mysqlId) {
  if (!resumeMode) return false;
  
  try {
    const result = await pool.query(
      'SELECT id FROM movies WHERE mysql_id = $1',
      [mysqlId]
    );
    return result.rows.length > 0;
  } catch (error) {
    return false;
  }
}

// Insert movie into database
async function insertMovie(movie, editionId) {
  try {
    const result = await pool.query(`
      INSERT INTO movies (
        mysql_id, edition_id, catalogue_year, name_cs, name_en, synopsis_cs, synopsis_en,
        fulltext_cs, image, image_data, runtime, director, year, country, "cast",
        premiere, section, is_35mm, has_delegation
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING id
    `, [
      movie.mysql_id,
      editionId,
      movie.catalogue_year,
      movie.name_cs,
      movie.name_en,
      movie.synopsis_cs,
      movie.synopsis_en,
      movie.fulltext_cs,
      movie.image,
      movie.image_data,
      movie.runtime,
      movie.director,
      movie.year,
      movie.country,
      movie.cast,
      movie.premiere,
      movie.section,
      movie.is_35mm,
      movie.has_delegation
    ]);
    
    return result.rows[0].id;
  } catch (error) {
    throw new Error(`Database insert failed: ${error.message}`);
  }
}

// Process movies in batches
async function processMoviesBatch(movies, startIndex) {
  const endIndex = Math.min(startIndex + batchSize, movies.length);
  const batch = movies.slice(startIndex, endIndex);
  
  console.log(`📦 Processing batch ${Math.floor(startIndex / batchSize) + 1}: movies ${startIndex + 1}-${endIndex} of ${movies.length}`);
  
  for (const movie of batch) {
    try {
      // Check if movie already exists (in resume mode)
      if (await movieExists(movie.mysql_id)) {
        console.log(`⏭️  Skipping movie ${movie.mysql_id} (already exists)`);
        stats.skipped++;
        continue;
      }
      
      // Validate required fields
      if (!movie.name_cs || !movie.fulltext_cs) {
        console.warn(`⚠️  Skipping movie ${movie.mysql_id}: missing required fields`);
        stats.skipped++;
        continue;
      }
      
      // Process image
      await processMovieImage(movie);
      
      // Ensure edition exists
      const editionId = await ensureEditionExists(movie.catalogue_year);
      if (!editionId) {
        console.warn(`⚠️  Skipping movie ${movie.mysql_id}: no valid edition`);
        stats.skipped++;
        continue;
      }
      
      // Insert movie (if not dry run)
      if (!isDryRun) {
        await insertMovie(movie, editionId);
      }
      
      stats.imported++;
      
      // Progress indicator
      if (stats.imported % 100 === 0) {
        console.log(`✅ Processed ${stats.imported} movies...`);
      }
      
    } catch (error) {
      console.error(`❌ Failed to process movie ${movie.mysql_id}: ${error.message}`);
      stats.errors++;
    }
  }
}

// Print statistics
function printStatistics() {
  const duration = Math.round((Date.now() - stats.startTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  
  console.log('\n📊 Movies Import Statistics');
  console.log('============================');
  console.log(`✅ Total movies found: ${stats.totalMovies}`);
  console.log(`✅ Movies imported: ${stats.imported}`);
  console.log(`⏭️  Movies skipped: ${stats.skipped}`);
  console.log(`❌ Errors encountered: ${stats.errors}`);
  console.log('');
  console.log('📸 Image Processing:');
  console.log(`   - Blob images processed: ${stats.blobImages}`);
  console.log(`   - File images processed: ${stats.fileImages}`);
  console.log(`   - Missing images: ${stats.missingImages}`);
  console.log('');
  console.log(`🏢 Editions created: ${stats.editionsCreated}`);
  console.log(`⏱️  Import completed in ${minutes}m ${seconds}s`);
  
  if (isDryRun) {
    console.log('\n🔍 DRY RUN MODE - No data was actually inserted');
  }
}

// Main import function
async function importMovies() {
  console.log('🎬 Movies Import Script');
  console.log('=======================');
  
  if (isDryRun) {
    console.log('🔍 Running in DRY RUN mode - no data will be inserted');
  }
  
  if (resumeMode) {
    console.log('🔄 Running in RESUME mode - skipping existing movies');
  }
  
  console.log(`📁 Using images base path: ${imagesBasePath}`);
  console.log(`📦 Batch size: ${batchSize}`);
  console.log('');
  
  try {
    // Test database connection
    console.log('🔌 Testing database connection...');
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful');
    
    // Fetch data from MySQL (preferred), TSV file, or MySQL dump file as fallback
    let movies = [];
    
    if (useMysql || (!fs.existsSync(path.join(process.cwd(), 'tmp', 'movies.tsv')) && !fs.existsSync(path.join(process.cwd(), 'movies_mysql.sql')))) {
      // Use MySQL connection (direct or via --mysql flag)
      movies = await fetchMoviesFromMySQL();
    } else {
      // Fallback to file-based import
      const tsvPath = path.join(process.cwd(), 'tmp', 'movies.tsv');
      const dumpPath = path.join(process.cwd(), 'movies_mysql.sql');
      
      if (fs.existsSync(tsvPath)) {
        console.log('📖 Reading TSV file...');
        const tsvContent = fs.readFileSync(tsvPath, 'utf8');
        movies = parseMoviesFromTSV(tsvContent);
      } else if (fs.existsSync(dumpPath)) {
        console.log('📖 Reading MySQL dump file...');
        const dumpContent = fs.readFileSync(dumpPath, 'utf8');
        movies = parseMoviesFromDump(dumpContent);
      } else {
        throw new Error(`No movie data source found. Use --mysql flag for direct connection, or provide ${tsvPath} or ${dumpPath}`);
      }
    }
    
    if (movies.length === 0) {
      throw new Error('No movies found in dump file');
    }
    
    // Process movies in batches
    for (let i = 0; i < movies.length; i += batchSize) {
      await processMoviesBatch(movies, i);
    }
    
    // Print final statistics
    printStatistics();
    
  } catch (error) {
    console.error(`💥 Import failed: ${error.message}`);
    process.exit(1);
  } finally {
    // Close database connection
    await pool.end();
  }
}

// Show help
function showHelp() {
  console.log('🎬 Movies Import Script');
  console.log('=======================');
  console.log('');
  console.log('Usage: node server/scripts/import-movies.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --mysql                Connect directly to MySQL database via SSH tunnel');
  console.log('  --dry-run              Test import without inserting data');
  console.log('  --resume               Skip movies that already exist');
  console.log('  --batch-size=N         Process N movies per batch (default: 100)');
  console.log(`  --images-dir=PATH      Base path for images (default: ${IMAGES_BASE_PATH})`);
  console.log('  --help                 Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node server/scripts/import-movies.js --dry-run');
  console.log('  node server/scripts/import-movies.js --batch-size=50');
  console.log('  node server/scripts/import-movies.js --images-dir=./movie-images');
  console.log('  node server/scripts/import-movies.js --resume');
}

// Check for help flag
if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

// Run the import
importMovies().catch(error => {
  console.error(`💥 Unexpected error: ${error.message}`);
  process.exit(1);
});