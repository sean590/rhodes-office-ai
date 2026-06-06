-- Proactive send-routing groundwork (Phase 1 follow-on).
--
-- Three signals decide which providers a document should be routed TO:
--   1. Learned, per-org rules (org_provider_routing_rules) — strengthened every
--      time the user actually sends a document type to a provider. Mirrors the
--      org_document_patterns completeness-learning model.
--   2. Seeded priors (document_types.route_to_disciplines) + app-layer keyword
--      hints for AI-minted types — the cold start before anything is learned.
--   3. Provenance veto (documents.source_provider_id) — never route a document
--      back to the provider it came from (a K-1 from Andersen never goes to
--      Andersen).
--
-- Surfacing of these suggestions at ingestion time is deferred until a secure
-- delivery path exists; this migration is the dormant groundwork.

-- 1. Provenance: which provider a document came from (nullable — often unknown).
ALTER TABLE documents
  ADD COLUMN source_provider_id UUID REFERENCES service_providers(id) ON DELETE SET NULL;
CREATE INDEX idx_documents_source_provider
  ON documents(source_provider_id) WHERE source_provider_id IS NOT NULL;

-- 2. Seeded routing intent per document type: which disciplines should RECEIVE
--    a document of this type. Global defaults; per-org learning layers on top.
ALTER TABLE document_types
  ADD COLUMN route_to_disciplines TEXT[] NOT NULL DEFAULT '{}';

UPDATE document_types SET route_to_disciplines = '{tax}'
  WHERE slug IN ('k1', 'tax_return_1065', 'tax_return_1120s', 'tax_return_1041', 'tax_return_1040');
UPDATE document_types SET route_to_disciplines = '{tax,bookkeeping}'
  WHERE slug = 'distribution_notice';

-- 3. Learned, per-org routing rules. UNIQUE(org, document_type, provider_id);
--    times_confirmed counts real sends, times_dismissed counts rejections,
--    confidence is derived. Mirrors org_document_patterns.
CREATE TABLE org_provider_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  provider_id UUID NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
  times_confirmed INTEGER NOT NULL DEFAULT 0,
  times_dismissed INTEGER NOT NULL DEFAULT 0,
  confidence FLOAT NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, document_type, provider_id)
);
CREATE INDEX idx_provider_routing_rules_org ON org_provider_routing_rules(organization_id);
CREATE INDEX idx_provider_routing_rules_lookup ON org_provider_routing_rules(organization_id, document_type);

ALTER TABLE org_provider_routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON org_provider_routing_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON org_provider_routing_rules
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON org_provider_routing_rules
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON org_provider_routing_rules
  FOR DELETE TO authenticated USING (true);
