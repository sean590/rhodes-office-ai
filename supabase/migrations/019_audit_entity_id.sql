-- Add entity_id to audit_log for efficient entity-scoped activity queries
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_id uuid;
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id ON audit_log(entity_id) WHERE entity_id IS NOT NULL;
