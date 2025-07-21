require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../models/database');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

// Calculate file checksum for integrity checking
function calculateChecksum(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

// Get list of migration files sorted by version
function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort();
  
  return files.map(filename => {
    const version = filename.split('_')[0];
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const checksum = calculateChecksum(content);
    
    // Extract description from first comment line
    const descriptionMatch = content.match(/-- Description: (.+)/);
    const description = descriptionMatch ? descriptionMatch[1] : '';
    
    return {
      version,
      filename,
      content,
      checksum,
      description
    };
  });
}

// Get applied migrations from database
async function getAppliedMigrations() {
  try {
    const result = await pool.query(
      'SELECT version, filename, checksum FROM schema_migrations ORDER BY version'
    );
    return result.rows;
  } catch (error) {
    // If table doesn't exist, return empty array
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }
}

// Initialize migration tracking table
async function initializeMigrationTracking() {
  console.log('🔧 Initializing migration tracking...');
  const trackingMigration = getMigrationFiles().find(m => m.version === '000');
  
  if (!trackingMigration) {
    throw new Error('Migration tracking file (000_migration_tracking.sql) not found');
  }
  
  await pool.query(trackingMigration.content);
  console.log('✅ Migration tracking initialized');
}

// Apply a single migration
async function applyMigration(migration) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log(`📋 Applying migration ${migration.version}: ${migration.filename}`);
    
    // Execute migration SQL
    await client.query(migration.content);
    
    // Record migration in tracking table
    await client.query(
      `INSERT INTO schema_migrations (version, filename, description, checksum) 
       VALUES ($1, $2, $3, $4)`,
      [migration.version, migration.filename, migration.description, migration.checksum]
    );
    
    await client.query('COMMIT');
    console.log(`✅ Migration ${migration.version} applied successfully`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ Migration ${migration.version} failed:`, error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Validate migration integrity
function validateMigration(migration, appliedMigration) {
  if (migration.checksum !== appliedMigration.checksum) {
    throw new Error(
      `Migration ${migration.version} checksum mismatch. ` +
      `Expected: ${appliedMigration.checksum}, Got: ${migration.checksum}. ` +
      `Migration file may have been modified after application.`
    );
  }
}

// Main migration function
async function runMigrations() {
  try {
    console.log('🚀 Starting database migrations...');
    
    const migrationFiles = getMigrationFiles();
    console.log(`📁 Found ${migrationFiles.length} migration files`);
    
    // Initialize migration tracking if needed
    const appliedMigrations = await getAppliedMigrations();
    
    if (appliedMigrations.length === 0) {
      await initializeMigrationTracking();
    }
    
    // Get updated applied migrations
    const currentAppliedMigrations = await getAppliedMigrations();
    const appliedVersions = new Set(currentAppliedMigrations.map(m => m.version));
    
    // Validate already applied migrations
    for (const appliedMigration of currentAppliedMigrations) {
      const migrationFile = migrationFiles.find(m => m.version === appliedMigration.version);
      if (migrationFile) {
        validateMigration(migrationFile, appliedMigration);
      }
    }
    
    // Apply pending migrations
    const pendingMigrations = migrationFiles.filter(m => !appliedVersions.has(m.version));
    
    if (pendingMigrations.length === 0) {
      console.log('✅ No pending migrations. Database is up to date.');
      return;
    }
    
    console.log(`📋 Applying ${pendingMigrations.length} pending migrations...`);
    
    for (const migration of pendingMigrations) {
      await applyMigration(migration);
    }
    
    console.log('🎉 All migrations completed successfully!');
    
  } catch (error) {
    console.error('💥 Migration failed:', error.message);
    throw error; // Re-throw for calling code to handle
  }
}

// Show migration status
async function showStatus() {
  try {
    const migrationFiles = getMigrationFiles();
    const appliedMigrations = await getAppliedMigrations();
    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    
    console.log('\n📊 Migration Status:');
    console.log('===================');
    
    for (const migration of migrationFiles) {
      const status = appliedVersions.has(migration.version) ? '✅ Applied' : '⏳ Pending';
      const appliedMigration = appliedMigrations.find(m => m.version === migration.version);
      const appliedAt = appliedMigration ? appliedMigration.applied_at : '';
      
      console.log(`${status} | ${migration.version} | ${migration.filename} | ${appliedAt}`);
    }
    
    const pendingCount = migrationFiles.filter(m => !appliedVersions.has(m.version)).length;
    console.log(`\n📋 Pending migrations: ${pendingCount}`);
    
  } catch (error) {
    console.error('Error showing status:', error.message);
    process.exit(1);
  }
}

// Export functions for use in other modules
module.exports = {
  runMigrations,
  showStatus,
  getMigrationFiles,
  getAppliedMigrations
};

// Command line interface (only when run directly)
if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case 'status':
      showStatus().then(() => process.exit(0));
      break;
    case 'migrate':
    case undefined:
      runMigrations().then(() => process.exit(0));
      break;
    default:
      console.log('Usage: node migrate.js [command]');
      console.log('Commands:');
      console.log('  migrate  - Run pending migrations (default)');
      console.log('  status   - Show migration status');
      process.exit(1);
  }
}