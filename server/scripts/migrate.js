const { createTables } = require('../models/database');

async function migrate() {
  try {
    console.log('Running database migrations...');
    await createTables();
    console.log('Migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();