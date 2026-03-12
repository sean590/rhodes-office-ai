-- Enable RLS on document_entity_links (was missing from migration 023)
ALTER TABLE document_entity_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON document_entity_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
