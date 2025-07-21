const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const XLSX = require('xlsx');
const axios = require('axios');
const { pool } = require('../models/database');

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';
const AUTH_TOKEN = process.env.AUTH_TOKEN; // You'll need to set this

async function downloadImage(url, guestName) {
  try {
    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      headers: {
        'Accept': 'image/webp,image/jpeg,image/jpg,image/png,image/*'
      }
    });
    const buffer = Buffer.from(response.data, 'binary');
    
    // Detect mime type from response headers or URL
    const contentType = response.headers['content-type'] || '';
    let mimeType = 'image/jpeg'; // default
    
    if (contentType.includes('webp')) {
      mimeType = 'image/webp';
    } else if (contentType.includes('png')) {
      mimeType = 'image/png';
    } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      mimeType = 'image/jpeg';
    } else if (url.toLowerCase().includes('.webp')) {
      mimeType = 'image/webp';
    } else if (url.toLowerCase().includes('.png')) {
      mimeType = 'image/png';
    }
    
    return { buffer, mimeType };
  } catch (error) {
    console.error(`Failed to download image from ${url}:`, error.message);
    return null;
  }
}

async function parseExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Read raw data to handle the unusual structure
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // Find the header row (contains "First name")
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, rawData.length); i++) {
    if (rawData[i] && rawData[i][0] === 'First name') {
      headerRowIndex = i;
      break;
    }
  }
  
  if (headerRowIndex === -1) {
    throw new Error('Could not find header row in Excel file');
  }
  
  const headers = rawData[headerRowIndex];
  const data = [];
  
  // Convert remaining rows to objects
  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = {};
    headers.forEach((header, index) => {
      if (header && rawData[i][index] !== undefined) {
        row[header] = rawData[i][index];
      }
    });
    data.push(row);
  }
  
  console.log(`Found ${data.length} data rows in Excel file`);
  console.log('Columns found:', headers.filter(h => h));
  
  return data;
}

async function processGuest(row, index) {
  try {
    // Extract email (take first if multiple)
    const emailField = row['All e-mails separated by comma'] || '';
    const email = emailField ? emailField.split(/[,;]/)[0].trim() : '';
    if (!email) {
      console.log(`Row ${index + 1}: Skipping - no email found`);
      return null;
    }
    
    // Extract phone (take first if multiple)
    const phone1 = row['All phones (1)'] || '';
    const phone2 = row['All phones (2)'] || '';
    const phone = phone1 || phone2;
    
    // Prepare guest data
    const guestData = {
      first_name: row['First name'] || '',
      last_name: row['Last name'] || '',
      email: email,
      phone: phone,
      company: row['Business cards (1) > Company > Full name'] || '',
      language: detectLanguage(row['Vocative'] || ''),
      greeting: row['Vocative'] || '',
      tags: row['All shared tags separated by comma'] ? 
        row['All shared tags separated by comma'].split(',').map(t => t.trim()).filter(t => t) : [],
      photo_url: row['Photo - direct path to file (for all users)'] || ''
    };
    
    console.log(`Processing guest ${index + 1}: ${guestData.first_name} ${guestData.last_name} (${guestData.email})`);
    
    return guestData;
  } catch (error) {
    console.error(`Error processing row ${index + 1}:`, error);
    return null;
  }
}

function detectLanguage(greeting) {
  if (!greeting) return 'english';
  
  // Simple language detection based on greeting
  const czechGreetings = ['vážený', 'vážená', 'milý', 'milá', 'drahý', 'drahá'];
  const lowerGreeting = greeting.toLowerCase();
  
  if (czechGreetings.some(g => lowerGreeting.includes(g))) {
    return 'czech';
  }
  
  return 'english';
}

async function checkExistingGuest(email) {
  const result = await pool.query(
    'SELECT id FROM guests WHERE email = $1',
    [email]
  );
  return result.rows.length > 0 ? result.rows[0].id : null;
}

async function createOrUpdateGuest(guestData) {
  const existingId = await checkExistingGuest(guestData.email);
  
  if (existingId) {
    console.log(`  Guest already exists with ID: ${existingId}`);
    // Update existing guest
    await pool.query(`
      UPDATE guests 
      SET first_name = $1, last_name = $2, phone = $3, company = $4, 
          language = $5, greeting = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
    `, [
      guestData.first_name, guestData.last_name, guestData.phone,
      guestData.company, guestData.language, guestData.greeting, existingId
    ]);
    return existingId;
  } else {
    // Create new guest
    const result = await pool.query(`
      INSERT INTO guests (first_name, last_name, email, phone, company, language, greeting)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      guestData.first_name, guestData.last_name, guestData.email,
      guestData.phone, guestData.company, guestData.language, guestData.greeting
    ]);
    console.log(`  Created new guest with ID: ${result.rows[0].id}`);
    return result.rows[0].id;
  }
}

async function assignTags(guestId, tags) {
  for (const tagName of tags) {
    try {
      // First, ensure tag exists
      await pool.query(
        'INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [tagName]
      );
      
      // Get tag ID
      const tagResult = await pool.query('SELECT id FROM tags WHERE name = $1', [tagName]);
      const tagId = tagResult.rows[0].id;
      
      // Assign tag to guest
      await pool.query(
        'INSERT INTO guest_tags (guest_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [guestId, tagId]
      );
      
      console.log(`  Assigned tag: ${tagName}`);
    } catch (error) {
      console.error(`  Failed to assign tag ${tagName}:`, error.message);
    }
  }
}

async function uploadPhoto(guestId, photoUrl, guestName) {
  if (!photoUrl) return;
  
  try {
    const imageData = await downloadImage(photoUrl, guestName);
    if (!imageData) return;
    
    // Convert to base64 with correct mime type
    const base64Photo = `data:${imageData.mimeType};base64,${imageData.buffer.toString('base64')}`;
    
    // Update guest with base64 photo
    await pool.query(
      'UPDATE guests SET photo = $1 WHERE id = $2',
      [base64Photo, guestId]
    );
    
    console.log(`  Uploaded photo directly to database (${imageData.mimeType})`);
  } catch (error) {
    console.error(`  Failed to upload photo:`, error.message);
  }
}

async function importGuests(limit = null, pauseOnPhoto = false) {
  try {
    console.log('Starting guest import...\n');
    
    const filePath = path.join(__dirname, '../../eventival_export.xlsx');
    const guests = await parseExcelFile(filePath);
    
    console.log('\nSample row structure:');
    console.log(JSON.stringify(guests[0], null, 2));
    console.log('\n');
    
    const guestsToProcess = limit ? guests.slice(0, limit) : guests;
    let successCount = 0;
    let errorCount = 0;
    let foundPhotoGuest = false;
    
    for (let i = 0; i < guestsToProcess.length; i++) {
      const guestData = await processGuest(guestsToProcess[i], i);
      
      if (!guestData) {
        errorCount++;
        continue;
      }
      
      try {
        // Create or update guest
        const guestId = await createOrUpdateGuest(guestData);
        
        // Assign tags
        if (guestData.tags.length > 0) {
          await assignTags(guestId, guestData.tags);
        }
        
        // Check if this guest has a photo URL
        if (guestData.photo_url && pauseOnPhoto && !foundPhotoGuest) {
          foundPhotoGuest = true;
          console.log(`\n🖼️  FOUND GUEST WITH PHOTO URL:`);
          console.log(`   Name: ${guestData.first_name} ${guestData.last_name}`);
          console.log(`   Email: ${guestData.email}`);
          console.log(`   Photo URL: ${guestData.photo_url}`);
          console.log(`   Row number: ${i + 1}`);
          
          // Try to upload the photo
          await uploadPhoto(guestId, guestData.photo_url, `${guestData.first_name} ${guestData.last_name}`);
          
          successCount++;
          console.log(`  ✓ Successfully processed\n`);
          
          console.log('\n⏸️  PAUSING IMPORT - First guest with photo found and processed.');
          console.log(`   Processed ${successCount} guests so far.`);
          console.log(`   Remaining guests to import: ${guests.length - (i + 1)}`);
          console.log(`   To continue full import, run: node server/scripts/import-guests.js full\n`);
          break;
        }
        
        // Upload photo if not pausing
        if (guestData.photo_url && !pauseOnPhoto) {
          await uploadPhoto(guestId, guestData.photo_url, `${guestData.first_name} ${guestData.last_name}`);
        }
        
        successCount++;
        console.log(`  ✓ Successfully processed\n`);
      } catch (error) {
        console.error(`  ✗ Failed to process: ${error.message}\n`);
        errorCount++;
      }
    }
    
    console.log('\n=== Import Summary ===');
    console.log(`Total processed: ${guestsToProcess.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    
    if (limit && guests.length > limit) {
      console.log(`\nRemaining guests to import: ${guests.length - limit}`);
      console.log('Run with no limit to import all guests.');
    }
    
  } catch (error) {
    console.error('Import failed:', error);
  } finally {
    await pool.end();
  }
}

// Check command line arguments
const args = process.argv.slice(2);
const command = args[0];

if (command === 'test') {
  console.log('Running test import with 20 guests...\n');
  importGuests(20, false);
} else if (command === 'full') {
  console.log('Running FULL import of all guests...\n');
  importGuests(null, false);
} else if (command === 'photo' || !command) {
  console.log('Running import until first guest with photo...\n');
  importGuests(null, true);
} else if (parseInt(command)) {
  console.log(`Running import with limit of ${command} guests...\n`);
  importGuests(parseInt(command), false);
} else {
  console.log('Usage:');
  console.log('  node import-guests.js         - Import until first guest with photo');
  console.log('  node import-guests.js test    - Import first 20 guests');
  console.log('  node import-guests.js full    - Import all guests');
  console.log('  node import-guests.js [N]     - Import first N guests');
  process.exit(0);
}