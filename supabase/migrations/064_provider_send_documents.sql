-- Multi-document send bundles. A provider_document_sends row is the SHARE
-- (one token, expiry, recipient, email); this join lists the documents in it.
-- provider_document_sends.document_id stays as the "primary" doc (first
-- selected — drives the send's entity_id and single-doc display); this table is
-- the source of truth for everything in the bundle, including the primary.

CREATE TABLE provider_document_send_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  send_id UUID NOT NULL REFERENCES provider_document_sends(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(send_id, document_id)
);
CREATE INDEX idx_send_documents_send ON provider_document_send_documents(send_id);
CREATE INDEX idx_send_documents_org ON provider_document_send_documents(organization_id);

-- Backfill: every existing single-doc send gets a bundle row for its document.
INSERT INTO provider_document_send_documents (organization_id, send_id, document_id)
SELECT organization_id, id, document_id FROM provider_document_sends
ON CONFLICT (send_id, document_id) DO NOTHING;

ALTER TABLE provider_document_send_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON provider_document_send_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON provider_document_send_documents
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON provider_document_send_documents
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON provider_document_send_documents
  FOR DELETE TO authenticated USING (true);
