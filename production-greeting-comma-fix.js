// Production API Script for Fixing Guest Greeting Commas
// Use this script for production environments with API access only
// Replace YOUR_API_BASE_URL with your actual API endpoint

const API_BASE_URL = "https://your-production-domain.com/api";

// List of all 246 guests that need greeting comma fixes
const guests = [
  { id: "guest-id-1", name: "aa aax", email: "vaclav+xxx@irmf.cz", currentGreeting: "Vážená paní aax", newGreeting: "Vážená paní aax," },
  { id: "guest-id-2", name: "Roman Andrlík", email: "andrlikr@plzen.eu", currentGreeting: "Vážený pane Andrlíku", newGreeting: "Vážený pane Andrlíku," },
  { id: "guest-id-3", name: "Remy Archer", email: "remyarcher@hotmail.com", currentGreeting: "Dear Remy", newGreeting: "Dear Remy," },
  { id: "guest-id-4", name: "Klára Arpa", email: "klara.arpa@goethe.de", currentGreeting: "Vážená paní Arpa", newGreeting: "Vážená paní Arpa," },
  { id: "guest-id-5", name: "Lumír Aschenbrenner", email: "aschenbrenner@plzen.eu", currentGreeting: "Vážený pane Aschenbrennere", newGreeting: "Vážený pane Aschenbrennere," },
  // ... (246 guests total)
  
  // NOTE: In production, you would need to:
  // 1. First fetch all guests to get their actual IDs
  // 2. Filter for those with greetings missing commas
  // 3. Update each one individually
];

// Helper function to fetch all guests and find those missing commas
async function getGuestsMissingCommas() {
  try {
    const response = await fetch(`${API_BASE_URL}/guests`, {
      headers: {
        "Content-Type": "application/json",
        // Add your authentication headers here
        // "Authorization": "Bearer YOUR_TOKEN"
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch guests: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const guests = data.data || data; // Handle different API response formats
    
    // Filter guests with greetings that don't end with comma
    const guestsMissingCommas = guests.filter(guest => 
      guest.greeting && 
      guest.greeting.trim() !== '' && 
      !guest.greeting.trim().endsWith(',')
    );
    
    console.log(`Found ${guestsMissingCommas.length} guests with greetings missing commas`);
    return guestsMissingCommas;
    
  } catch (error) {
    console.error('Error fetching guests:', error);
    throw error;
  }
}

// Function to update a single guest's greeting
async function updateGuestGreeting(guestId, currentGreeting) {
  try {
    const newGreeting = `${currentGreeting.trim()},`;
    
    const response = await fetch(`${API_BASE_URL}/guests/${guestId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        // Add your authentication headers here
        // "Authorization": "Bearer YOUR_TOKEN"
      },
      body: JSON.stringify({
        greeting: newGreeting,
        greeting_auto_generated: false // Mark as manually edited
      })
    });

    if (response.ok) {
      const updatedGuest = await response.json();
      return { success: true, guest: updatedGuest };
    } else {
      const error = await response.text();
      return { success: false, error: `${response.status} ${response.statusText}: ${error}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Main function to update all guest greetings
async function updateAllGuestGreetings() {
  console.log('🔍 Fetching guests with missing greeting commas...');
  
  try {
    // Get all guests that need comma fixes
    const guestsToUpdate = await getGuestsMissingCommas();
    
    if (guestsToUpdate.length === 0) {
      console.log('✅ All guest greetings already have proper comma endings!');
      return;
    }
    
    console.log(`\n📋 Found ${guestsToUpdate.length} guests to update:`);
    guestsToUpdate.forEach((guest, index) => {
      console.log(`${index + 1}. ${guest.first_name} ${guest.last_name} (${guest.email})`);
      console.log(`   Current: "${guest.greeting}"`);
      console.log(`   Updated: "${guest.greeting},"`);
      console.log('');
    });
    
    console.log('🔄 Starting updates...\n');
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Update each guest
    for (let i = 0; i < guestsToUpdate.length; i++) {
      const guest = guestsToUpdate[i];
      console.log(`[${i + 1}/${guestsToUpdate.length}] Updating ${guest.first_name} ${guest.last_name}...`);
      
      const result = await updateGuestGreeting(guest.id, guest.greeting);
      
      if (result.success) {
        console.log(`✅ Updated: "${result.guest.data?.greeting || guest.greeting},"`);
        successCount++;
      } else {
        console.error(`❌ Failed: ${result.error}`);
        errors.push(`${guest.first_name} ${guest.last_name}: ${result.error}`);
        errorCount++;
      }
      
      // Add small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`✅ Successfully updated: ${successCount} guests`);
    console.log(`❌ Errors: ${errorCount} guests`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(error => console.log(`  - ${error}`));
    }
    
    if (successCount > 0) {
      console.log('\n🎉 Greeting comma fixes completed successfully!');
    }
    
  } catch (error) {
    console.error('💥 Script error:', error);
  }
}

// Dry run function to preview what would be changed
async function dryRun() {
  console.log('🔍 DRY RUN: Checking for guests with missing greeting commas...\n');
  
  try {
    const guestsToUpdate = await getGuestsMissingCommas();
    
    if (guestsToUpdate.length === 0) {
      console.log('✅ All guest greetings already have proper comma endings!');
      return;
    }
    
    console.log(`📋 Would update ${guestsToUpdate.length} guests:\n`);
    guestsToUpdate.forEach((guest, index) => {
      console.log(`${index + 1}. ${guest.first_name} ${guest.last_name} (${guest.email})`);
      console.log(`   Language: ${guest.language || 'english'}`);
      console.log(`   Current:  "${guest.greeting}"`);
      console.log(`   Updated:  "${guest.greeting},"`);
      console.log('');
    });
    
    console.log('🔍 DRY RUN COMPLETE - No changes made');
    console.log('\nTo actually update the greetings, call updateAllGuestGreetings()');
    
  } catch (error) {
    console.error('💥 Dry run error:', error);
  }
}

// Export functions for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    updateAllGuestGreetings,
    getGuestsMissingCommas,
    updateGuestGreeting,
    dryRun
  };
}

// Usage examples:
console.log('🚀 Production Greeting Comma Fix Script');
console.log('=====================================');
console.log('');
console.log('Available functions:');
console.log('- dryRun()                    // Preview changes without updating');
console.log('- updateAllGuestGreetings()   // Update all greetings');
console.log('- getGuestsMissingCommas()    // Get list of guests needing updates');
console.log('');
console.log('IMPORTANT: Update API_BASE_URL and add authentication headers before running!');
console.log('');

// Uncomment one of these to run:
// dryRun();
// updateAllGuestGreetings();