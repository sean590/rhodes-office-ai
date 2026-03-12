-- Multi-entity document associations
-- Documents can be linked to multiple entities beyond the primary entity_id

CREATE TABLE document_entity_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'related',
  source TEXT NOT NULL DEFAULT 'manual',
  confidence FLOAT,
  ai_reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(document_id, entity_id)
);

CREATE INDEX idx_doc_entity_links_doc ON document_entity_links(document_id);
CREATE INDEX idx_doc_entity_links_entity ON document_entity_links(entity_id);
CREATE INDEX idx_doc_entity_links_org ON document_entity_links(organization_id);

-- Add ai_related_entities column to document_queue for storing AI-detected links before ingestion
ALTER TABLE document_queue ADD COLUMN IF NOT EXISTS ai_related_entities JSONB;

-- Backfill: create primary links for all existing documents with an entity_id
INSERT INTO document_entity_links (document_id, entity_id, organization_id, role, source, confidence)
SELECT d.id, d.entity_id, d.organization_id, 'primary', 'ai', 1.0
FROM documents d
WHERE d.entity_id IS NOT NULL
  AND d.deleted_at IS NULL
ON CONFLICT (document_id, entity_id) DO NOTHING;
