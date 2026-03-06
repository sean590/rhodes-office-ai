-- The original audit_log table has table_name (NOT NULL) and record_id (NOT NULL UUID)
-- which are legacy columns. The app uses resource_type/resource_id instead (added in 009).
-- Inserts have been silently failing because these NOT NULL constraints are violated.

ALTER TABLE audit_log ALTER COLUMN table_name DROP NOT NULL;
ALTER TABLE audit_log ALTER COLUMN record_id DROP NOT NULL;
