#!/usr/bin/env node

// Script to fix missing commas in guest greetings
// Usage: node fix-greeting-commas.js [--dry-run]

const { Pool } = require('pg');

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER || 'festival_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'festival_db',
  password: process.env.DB_PASSWORD || 'festival_pass',
  port: process.env.DB_PORT || 5432,
});

async function findGuestsWithMissingCommas() {
  const result = await pool.query(`
    SELECT 
      id, 
      first_name, 
      last_name, 
      email,
      greeting,
      language
    FROM guests 
    WHERE greeting IS NOT NULL 
    AND greeting != '' 
    AND greeting NOT LIKE '%,'
    ORDER BY last_name, first_name
  `);
  
  return result.rows;
}

async function updateGuestGreeting(guestId, newGreeting) {
  const result = await pool.query(`
    UPDATE guests 
    SET greeting = $1, greeting_auto_generated = FALSE
    WHERE id = $2
    RETURNING first_name, last_name, greeting
  `, [newGreeting, guestId]);
  
  return result.rows[0];
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  
  console.log('🔍 Finding guests with greetings missing commas...\n');
  
  try {
    const guests = await findGuestsWithMissingCommas();
    
    if (guests.length === 0) {
      console.log('✅ All guest greetings already have proper comma endings!');
      return;
    }
    
    console.log(`Found ${guests.length} guests with greetings missing commas:\n`);
    
    // Show the list of guests
    console.log('📋 LIST OF GUESTS TO UPDATE:');
    console.log('============================');
    guests.forEach((guest, index) => {
      console.log(`${index + 1}. ${guest.first_name} ${guest.last_name} (${guest.email})`);
      console.log(`   Language: ${guest.language || 'english'}`);
      console.log(`   Current:  "${guest.greeting}"`);
      console.log(`   Updated:  "${guest.greeting},"`);
      console.log('');
    });
    
    if (isDryRun) {
      console.log('🔍 DRY RUN MODE - No changes made to database');
      console.log('\nTo actually update the database, run:');
      console.log('node fix-greeting-commas.js');
      return;
    }
    
    // Ask for confirmation
    console.log('⚠️  This will update greetings for all guests listed above.');
    console.log('Press Ctrl+C to cancel, or any key to continue...');
    
    // Wait for user input (in a real script, you might want to use readline)
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    
    console.log('\n🔄 Updating greetings...\n');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const guest of guests) {
      try {
        const newGreeting = `${guest.greeting},`;
        const updated = await updateGuestGreeting(guest.id, newGreeting);
        
        console.log(`✅ ${updated.first_name} ${updated.last_name}: "${updated.greeting}"`);
        successCount++;
      } catch (error) {
        console.error(`❌ Error updating ${guest.first_name} ${guest.last_name}: ${error.message}`);
        errorCount++;
      }
    }
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`✅ Successfully updated: ${successCount} guests`);
    console.log(`❌ Errors: ${errorCount} guests`);
    
    if (successCount > 0) {
      console.log('\n🎉 Greeting comma fixes completed successfully!');
    }
    
  } catch (error) {
    console.error('💥 Script error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Production API script generator
function generateProductionScript(guests) {
  console.log('\n🚀 PRODUCTION API SCRIPT:');
  console.log('========================');
  console.log('// Use this script for production environments with API access only');
  console.log('// Replace YOUR_API_BASE_URL with your actual API endpoint');
  console.log('');
  console.log('const API_BASE_URL = "https://your-production-domain.com/api";');
  console.log('const guests = [');
  
  guests.forEach((guest, index) => {
    console.log(`  {`);
    console.log(`    id: ${guest.id},`);
    console.log(`    name: "${guest.first_name} ${guest.last_name}",`);
    console.log(`    email: "${guest.email}",`);
    console.log(`    currentGreeting: "${guest.greeting}",`);
    console.log(`    newGreeting: "${guest.greeting},"`);
    console.log(`  }${index < guests.length - 1 ? ',' : ''}`);
  });
  
  console.log('];');
  console.log('');
  console.log('async function updateGuestGreetings() {');
  console.log('  for (const guest of guests) {');
  console.log('    try {');
  console.log('      const response = await fetch(`${API_BASE_URL}/guests/${guest.id}`, {');
  console.log('        method: "PUT",');
  console.log('        headers: {');
  console.log('          "Content-Type": "application/json",');
  console.log('          // Add your authentication headers here');
  console.log('          // "Authorization": "Bearer YOUR_TOKEN"');
  console.log('        },');
  console.log('        body: JSON.stringify({');
  console.log('          greeting: guest.newGreeting,');
  console.log('          greeting_auto_generated: false');
  console.log('        })');
  console.log('      });');
  console.log('');
  console.log('      if (response.ok) {');
  console.log('        console.log(`✅ Updated ${guest.name}: "${guest.newGreeting}"`);');
  console.log('      } else {');
  console.log('        console.error(`❌ Error updating ${guest.name}: ${response.status} ${response.statusText}`);');
  console.log('      }');
  console.log('    } catch (error) {');
  console.log('      console.error(`❌ Error updating ${guest.name}:`, error);');
  console.log('    }');
  console.log('  }');
  console.log('}');
  console.log('');
  console.log('updateGuestGreetings();');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { findGuestsWithMissingCommas, updateGuestGreeting };