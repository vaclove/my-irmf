-- Migration: 001_initial_schema.sql
-- Description: Create initial database schema with all tables and types
-- Date: 2025-07-13

-- Enable required extensions
-- Note: uuid-ossp not supported in Azure, using gen_random_uuid() instead

-- Create custom enum types
CREATE TYPE guest_language AS ENUM ('czech', 'english');
CREATE TYPE guest_category AS ENUM ('filmmaker', 'press', 'guest', 'staff');

-- Create main tables
CREATE TABLE guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  language guest_language DEFAULT 'english',
  company VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE guest_editions (
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

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  color VARCHAR(7) DEFAULT '#3B82F6',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE guest_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guest_id, tag_id)
);

CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  language guest_language DEFAULT 'english',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE template_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  example VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE guest_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
  edition_id UUID REFERENCES editions(id) ON DELETE CASCADE,
  template_id UUID REFERENCES email_templates(id),
  invited_at TIMESTAMP,
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

CREATE TABLE audit_logs (
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

-- Create session table for PostgreSQL session store
CREATE TABLE "session" (
  "sid" varchar PRIMARY KEY NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);

-- Create indexes for performance
CREATE INDEX idx_audit_logs_user_email ON audit_logs(user_email);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource);
CREATE INDEX idx_audit_logs_resource_id ON audit_logs(resource_id);
CREATE INDEX idx_audit_logs_user_ip ON audit_logs(user_ip);
CREATE INDEX idx_guest_tags_guest_id ON guest_tags(guest_id);
CREATE INDEX idx_guest_tags_tag_id ON guest_tags(tag_id);
CREATE INDEX idx_guest_invitations_guest_id ON guest_invitations(guest_id);
CREATE INDEX idx_guest_invitations_edition_id ON guest_invitations(edition_id);
CREATE INDEX idx_guest_invitations_token ON guest_invitations(token);
CREATE INDEX idx_guest_invitations_status ON guest_invitations(status);
CREATE INDEX idx_guests_email ON guests(email);
CREATE INDEX idx_guests_language ON guests(language);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");

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