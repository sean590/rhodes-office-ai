-- ============================================================================
-- 014: Add composite indexes for multi-tenant query performance
-- ============================================================================

-- Org-scoped composite indexes on root tables (most common query patterns)
CREATE INDEX IF NOT EXISTS idx_entities_org_status ON entities(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_entities_org_type ON entities(organization_id, type);
CREATE INDEX IF NOT EXISTS idx_documents_org_type ON documents(organization_id, document_type);
CREATE INDEX IF NOT EXISTS idx_documents_org_created ON documents(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_directory_org_name ON directory_entries(organization_id, name);
CREATE INDEX IF NOT EXISTS idx_relationships_org_type ON relationships(organization_id, type);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_org_user ON chat_sessions(organization_id, user_id);

-- created_at DESC indexes for sorting on list pages
CREATE INDEX IF NOT EXISTS idx_entities_created_at ON entities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_directory_entries_created_at ON directory_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationships_created_at ON relationships(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_batches_created_at ON document_batches(created_at DESC);

-- Compliance obligations: composite for cron reminder query
CREATE INDEX IF NOT EXISTS idx_compliance_status_date_entity
  ON compliance_obligations(status, next_due_date, entity_id)
  WHERE status = 'pending';

-- Document queue: batch + status lookups (no organization_id column on this table)
CREATE INDEX IF NOT EXISTS idx_document_queue_batch_status ON document_queue(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_document_queue_hash ON document_queue(content_hash);
