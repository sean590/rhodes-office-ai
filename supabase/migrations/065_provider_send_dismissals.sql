-- Dismissed proactive send-suggestions. When the user dismisses a suggested
-- "send this document to this provider", it is recorded here so it never
-- resurfaces, and the routing rule is decayed (times_dismissed++). The proactive
-- engine excludes any (document, provider) pair present here.

CREATE TABLE provider_send_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
  dismissed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id, provider_id)
);
CREATE INDEX idx_send_dismissals_org ON provider_send_dismissals(organization_id);

ALTER TABLE provider_send_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON provider_send_dismissals
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON provider_send_dismissals
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON provider_send_dismissals
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON provider_send_dismissals
  FOR DELETE TO authenticated USING (true);
