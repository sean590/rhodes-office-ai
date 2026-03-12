-- Support for umbrella documents that create multiple entities
ALTER TABLE document_queue ADD COLUMN IF NOT EXISTS ai_proposed_entities JSONB;
