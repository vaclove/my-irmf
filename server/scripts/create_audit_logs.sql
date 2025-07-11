-- Create audit logs table for tracking all CRUD operations and authentication events

-- Step 1: Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_email VARCHAR(255), -- From Google auth, can be null for localhost
  user_ip VARCHAR(45), -- Support both IPv4 and IPv6
  action VARCHAR(50) NOT NULL, -- CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT, AUTH_FAIL
  resource VARCHAR(100) NOT NULL, -- guests, editions, tags, invitations, etc.
  resource_id VARCHAR(255), -- ID of the affected resource, if applicable
  old_data JSONB, -- Previous state for UPDATE/DELETE operations
  new_data JSONB, -- New state for CREATE/UPDATE operations
  metadata JSONB, -- Additional context (user agent, request details, etc.)
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  success BOOLEAN DEFAULT TRUE -- Track if operation was successful
);

-- Step 2: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_email ON audit_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id ON audit_logs(resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_ip ON audit_logs(user_ip);

-- Step 3: Create function to automatically log audit events
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
) RETURNS UUID AS $$
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
$$ LANGUAGE plpgsql;

-- Step 4: Display table structure
\d audit_logs;

-- Step 5: Show that table is empty (fresh start)
SELECT COUNT(*) as audit_log_count FROM audit_logs;