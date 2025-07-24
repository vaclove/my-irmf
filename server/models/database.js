const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Set timezone to avoid date conversion issues
pool.on('connect', (client) => {
  client.query('SET timezone = "Europe/Prague"');
});

const createTables = async () => {
  console.log('🔧 Starting database migration process...');
  const client = await pool.connect();
  try {
    console.log('✅ Database connection established');
    
    
    // Step 1: Create guest_language enum type
    console.log('🌐 Creating guest_language enum type...');
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE guest_language AS ENUM ('czech', 'english');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✅ Guest language enum type created');

    // Step 2: Create guests table
    console.log('📋 Creating guests table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS guests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(50),
        language guest_language DEFAULT 'english',
        company VARCHAR(255),
        note TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Guests table created');

    // Step 3: Create editions table
    console.log('📅 Creating editions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS editions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        year INTEGER UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        start_date DATE,
        end_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Editions table created');

    // Step 4: Create guest_category enum type
    console.log('🏷️ Creating guest_category enum type...');
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE guest_category AS ENUM ('filmmaker', 'press', 'guest', 'staff');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✅ Guest category enum type created');

    // Step 5: Create guest_editions table
    console.log('🔗 Creating guest_editions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS guest_editions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
        edition_id UUID REFERENCES editions(id) ON DELETE CASCADE,
        category guest_category NOT NULL,
        invited_at TIMESTAMP,
        confirmed_at TIMESTAMP,
        confirmation_token VARCHAR(255),
        accommodation BOOLEAN DEFAULT false,
        covered_nights INTEGER DEFAULT 0,
        UNIQUE(guest_id, edition_id)
      );
    `);
    console.log('✅ Guest editions table created');

    // Step 6: Create tags table
    console.log('🏷️ Creating tags table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) UNIQUE NOT NULL,
        color VARCHAR(7) DEFAULT '#3B82F6',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tags table created');

    // Step 7: Create guest_tags table
    console.log('🔗 Creating guest_tags table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS guest_tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
        tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guest_id, tag_id)
      );
    `);
    console.log('✅ Guest tags table created');

    // Step 8: Create email_templates table
    console.log('📧 Creating email_templates table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) UNIQUE NOT NULL,
        subject VARCHAR(500) NOT NULL,
        body TEXT NOT NULL,
        language guest_language DEFAULT 'english',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Email templates table created');

    // Step 9: Create template_variables table
    console.log('📝 Creating template_variables table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS template_variables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        example VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Template variables table created');

    // Step 10: Create guest_invitations table
    console.log('✉️ Creating guest_invitations table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS guest_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
        edition_id UUID REFERENCES editions(id) ON DELETE CASCADE,
        template_id UUID REFERENCES email_templates(id),
        sent_at TIMESTAMP,
        opened_at TIMESTAMP,
        clicked_at TIMESTAMP,
        confirmed_at TIMESTAMP,
        declined_at TIMESTAMP,
        token VARCHAR(255) UNIQUE,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guest_id, edition_id, template_id)
      );
    `);
    console.log('✅ Guest invitations table created');

    // Step 11: Create audit logs table
    console.log('📊 Creating audit_logs table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    `);
    console.log('✅ Audit logs table created');

    // Step 12: Create indexes for performance
    console.log('⚡ Creating database indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_email ON audit_logs(user_email);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id ON audit_logs(resource_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_ip ON audit_logs(user_ip);
      CREATE INDEX IF NOT EXISTS idx_guest_tags_guest_id ON guest_tags(guest_id);
      CREATE INDEX IF NOT EXISTS idx_guest_tags_tag_id ON guest_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_guest_invitations_guest_id ON guest_invitations(guest_id);
      CREATE INDEX IF NOT EXISTS idx_guest_invitations_edition_id ON guest_invitations(edition_id);
      CREATE INDEX IF NOT EXISTS idx_guest_invitations_token ON guest_invitations(token);
      CREATE INDEX IF NOT EXISTS idx_guest_invitations_status ON guest_invitations(status);
      CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email);
      CREATE INDEX IF NOT EXISTS idx_guests_language ON guests(language);
    `);
    console.log('✅ Database indexes created');

    // Step 13: Create audit logging function
    console.log('⚙️ Creating log_audit_event function...');
    await client.query(`
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
    console.log('✅ Audit logging function created');

    // Step 14: Create session table for PostgreSQL session store
    console.log('🗂️ Creating session table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar PRIMARY KEY NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);
    console.log('✅ Session table created');
    
    console.log('🎉 Database migration completed successfully!');
  } finally {
    client.release();
  }
};

module.exports = { pool, createTables };