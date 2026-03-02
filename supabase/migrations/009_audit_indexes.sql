-- Add columns needed for go-live audit logging
-- The existing audit_log table has: id, user_id, action, table_name, record_id, old_data, new_data, created_at
-- We add: resource_type, resource_id (text), metadata, ip_address, user_agent, session_id

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS resource_type TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS resource_id TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Performance indexes for new columns
CREATE INDEX IF NOT EXISTS idx_audit_resource_type
  ON audit_log (resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user_time
  ON audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_action_time
  ON audit_log (action, created_at DESC);
