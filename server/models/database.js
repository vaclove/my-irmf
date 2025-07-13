const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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

      -- Create audit logs table
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_email VARCHAR(255),
        user_ip VARCHAR(45),
        action VARCHAR(50) NOT NULL,
        resource VARCHAR(100) NOT NULL,
        resource_id VARCHAR(255),
        old_data JSONB,
        new_data JSONB,
        metadata JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        success BOOLEAN DEFAULT TRUE
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_email ON audit_logs(user_email);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id ON audit_logs(resource_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_ip ON audit_logs(user_ip);

      -- Create audit logging function
      CREATE OR REPLACE FUNCTION log_audit_event(
        p_user_email VARCHAR(255),
        p_user_ip VARCHAR(45),
        p_action VARCHAR(50),
        p_resource VARCHAR(100),
        p_resource_id VARCHAR(255) DEFAULT NULL,
        p_old_data JSONB DEFAULT NULL,
        p_new_data JSONB DEFAULT NULL,
        p_metadata JSONB DEFAULT NULL,
        p_success BOOLEAN DEFAULT TRUE
      ) RETURNS UUID AS $func$
      DECLARE
        audit_id UUID;
      BEGIN
        INSERT INTO audit_logs (
          user_email, user_ip, action, resource, resource_id, 
          old_data, new_data, metadata, success
        ) VALUES (
          p_user_email, p_user_ip, p_action, p_resource, p_resource_id,
          p_old_data, p_new_data, p_metadata, p_success
        ) RETURNING id INTO audit_id;
        
        RETURN audit_id;
      END;
      $func$ LANGUAGE plpgsql;
    `);
    console.log('Database tables created successfully');
  } finally {
    client.release();
  }
};

module.exports = { pool, createTables };