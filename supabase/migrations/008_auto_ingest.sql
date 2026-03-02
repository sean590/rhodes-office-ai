-- ============================================================================
-- 008: Auto-Ingest — Add auto_ingested status and routing columns
-- ============================================================================

-- Add auto_ingested to queue_status enum
ALTER TYPE queue_status ADD VALUE 'auto_ingested' AFTER 'approved';

-- Add routing columns to document_queue
ALTER TABLE document_queue ADD COLUMN entity_match_confidence TEXT DEFAULT 'none';
ALTER TABLE document_queue ADD COLUMN approval_reason TEXT;
