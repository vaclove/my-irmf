require('dotenv').config();
const { pool } = require('../models/database');

// Updated color mapping
const COLOR_UPDATES = {
  'feature': '#1C4563',
  'documentary': '#4C762C', 
  'short': '#ECB21E',
  'retrospective': '#51A9A6',
  'special': '#DF342C',
  'workshop': '#929289',
  'concert': '#929289',
  'discussion': '#F3C09F'
};

async function updateSectionColors() {
  const client = await pool.connect();
  
  try {
    console.log('🎨 Updating section colors for 2024 edition...');
    
    // First, find the 2024 edition ID
    const editionResult = await client.query(
      "SELECT id, name FROM editions WHERE name ILIKE '%2024%' ORDER BY created_at DESC LIMIT 1"
    );
    
    if (editionResult.rows.length === 0) {
      console.log('❌ No 2024 edition found in database');
      return;
    }
    
    const editionId = editionResult.rows[0].id;
    const editionName = editionResult.rows[0].name;
    console.log(`📍 Found edition: ${editionName} (${editionId})`);
    
    // Get existing sections for this edition
    const sectionsResult = await client.query(
      'SELECT id, key, name_cs, color_code FROM sections WHERE edition_id = $1',
      [editionId]
    );
    
    console.log(`📋 Found ${sectionsResult.rows.length} existing sections`);
    
    if (sectionsResult.rows.length === 0) {
      console.log('ℹ️  No sections found for this edition. Creating default sections...');
      
      // Create default sections with new colors
      const DEFAULT_SECTIONS = [
        { key: 'feature', name_cs: 'Celovečerní filmy', name_en: 'Feature Films', color_code: '#1C4563', sort_order: 1 },
        { key: 'documentary', name_cs: 'Dokumentární filmy', name_en: 'Documentary Films', color_code: '#4C762C', sort_order: 2 },
        { key: 'short', name_cs: 'Krátké filmy', name_en: 'Short Films', color_code: '#ECB21E', sort_order: 3 },
        { key: 'retrospective', name_cs: 'Retrospektiva', name_en: 'Retrospective', color_code: '#51A9A6', sort_order: 4 },
        { key: 'special', name_cs: 'Speciální projekce', name_en: 'Special Screenings', color_code: '#DF342C', sort_order: 5 },
        { key: 'workshop', name_cs: 'Workshop', name_en: 'Workshop', color_code: '#929289', sort_order: 6 },
        { key: 'concert', name_cs: 'Koncert', name_en: 'Concert', color_code: '#929289', sort_order: 7 },
        { key: 'discussion', name_cs: 'Diskuze', name_en: 'Discussion', color_code: '#F3C09F', sort_order: 8 }
      ];
      
      await client.query('BEGIN');
      
      for (const section of DEFAULT_SECTIONS) {
        await client.query(`
          INSERT INTO sections (edition_id, key, name_cs, name_en, color_code, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [editionId, section.key, section.name_cs, section.name_en, section.color_code, section.sort_order]);
        
        console.log(`➕ Created section: ${section.name_cs} (${section.key}) - ${section.color_code}`);
      }
      
      await client.query('COMMIT');
      console.log('✅ Default sections created successfully');
      
    } else {
      // Update existing sections
      await client.query('BEGIN');
      
      let updatedCount = 0;
      
      for (const section of sectionsResult.rows) {
        const newColor = COLOR_UPDATES[section.key];
        
        if (newColor && newColor !== section.color_code) {
          await client.query(
            'UPDATE sections SET color_code = $1 WHERE id = $2',
            [newColor, section.id]
          );
          
          console.log(`🎨 Updated ${section.name_cs} (${section.key}): ${section.color_code} → ${newColor}`);
          updatedCount++;
        } else if (newColor) {
          console.log(`✓ ${section.name_cs} (${section.key}): already has correct color ${newColor}`);
        } else {
          console.log(`ℹ️  ${section.name_cs} (${section.key}): no color update defined`);
        }
      }
      
      await client.query('COMMIT');
      console.log(`✅ Updated ${updatedCount} section colors successfully`);
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error updating section colors:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the update
updateSectionColors()
  .then(() => {
    console.log('🎉 Section color update completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Update failed:', error);
    process.exit(1);
  });