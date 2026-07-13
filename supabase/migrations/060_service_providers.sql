-- Service Providers (Phase 1 routing hub). Firms (CPA, bookkeeper, attorney, etc.)
-- that Rhodes routes documents to. Recognized by email domain, linked to the
-- entities they serve. provider_document_sends records every outbound delivery
-- (record-keeping is the point — this is distribution, not financial tracking).
--
-- Considered reusing directory_entries (type=external_entity) but it has no
-- domain/discipline/entity-association model; a dedicated set of tables is cleaner.
-- A provider may still optionally reference an existing directory_entries row via
-- directory_entry_id.
--
-- RLS follows the internal-tool 'authenticated' pattern (matches 058): the four
-- authenticated_* policies are permissive; org isolation is enforced in the app
-- layer (every query scopes by organization_id), per house convention.

CREATE TABLE service_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  disciplines TEXT[] NOT NULL DEFAULT '{}',          -- e.g. {'tax','bookkeeping','legal','valuation','wealth_mgmt','registered_agent','trustee'}
  domains TEXT[] NOT NULL DEFAULT '{}',              -- e.g. {'andersen.com'} — firm-by-domain recognition
  contacts JSONB NOT NULL DEFAULT '[]',              -- [{ "name": "...", "email": "...", "role": "...", "is_default": true }]
  default_contact_email TEXT,                        -- convenience; falls back to the is_default contact
  serves_all_entities BOOLEAN NOT NULL DEFAULT false,
  directory_entry_id UUID REFERENCES directory_entries(id) ON DELETE SET NULL,  -- optional link to an existing contact record
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_service_providers_org ON service_providers(organization_id);
CREATE INDEX idx_service_providers_deleted_at ON service_providers(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE service_provider_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_id, entity_id)
);
CREATE INDEX idx_sp_entities_provider ON service_provider_entities(provider_id);
CREATE INDEX idx_sp_entities_entity ON service_provider_entities(entity_id);
CREATE INDEX idx_sp_entities_org ON service_provider_entities(organization_id);

CREATE TABLE provider_document_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  resend_message_id TEXT,
  error TEXT,
  sent_by UUID REFERENCES auth.users(id),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_provider_sends_org ON provider_document_sends(organization_id);
CREATE INDEX idx_provider_sends_provider ON provider_document_sends(provider_id);
CREATE INDEX idx_provider_sends_document ON provider_document_sends(document_id);

-- RLS: internal-tool 'authenticated' pattern (matches 058; org isolation in app layer).
ALTER TABLE service_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON service_providers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON service_providers
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON service_providers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON service_providers
  FOR DELETE TO authenticated USING (true);

ALTER TABLE service_provider_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON service_provider_entities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON service_provider_entities
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON service_provider_entities
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON service_provider_entities
  FOR DELETE TO authenticated USING (true);

ALTER TABLE provider_document_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON provider_document_sends
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON provider_document_sends
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON provider_document_sends
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON provider_document_sends
  FOR DELETE TO authenticated USING (true);
