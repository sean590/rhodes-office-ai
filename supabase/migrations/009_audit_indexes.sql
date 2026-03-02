-- Audit log performance indexes
CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_log (resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user
  ON audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_action
  ON audit_log (action, created_at DESC);
