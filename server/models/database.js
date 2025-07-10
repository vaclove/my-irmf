const { Pool } = require('pg');

const pool = new Pool({
  user: 'festival_user',
  host: 'localhost',
  database: 'festival_db',
  password: 'festival_pass',
  port: 5432,
});

const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      
      CREATE TABLE IF NOT EXISTS guests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS editions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        year INTEGER UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        start_date DATE,
        end_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      DO $$ BEGIN
        CREATE TYPE guest_category AS ENUM ('filmmaker', 'press', 'guest', 'staff');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      CREATE TABLE IF NOT EXISTS guest_editions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
        edition_id UUID REFERENCES editions(id) ON DELETE CASCADE,
        category guest_category NOT NULL,
        invited_at TIMESTAMP,
        confirmed_at TIMESTAMP,
        confirmation_token VARCHAR(255),
        UNIQUE(guest_id, edition_id)
      );
    `);
    console.log('Database tables created successfully');
  } finally {
    client.release();
  }
};

module.exports = { pool, createTables };