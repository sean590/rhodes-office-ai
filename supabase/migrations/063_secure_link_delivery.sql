-- Secure link delivery (rhodes_native, no-OTP). Documents go to providers as a
-- Rhodes share link, not an attachment: the file stays in Supabase storage and
-- is served lazily through an access-logged page that mints a short-lived
-- signed URL. The token is the capability — unguessable (>=32 random bytes),
-- expiring, and revocable. See rhodes-secure-link-delivery-mini-spec.md.

ALTER TABLE provider_document_sends
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_provider_sends_share_token
  ON provider_document_sends(share_token) WHERE share_token IS NOT NULL;

-- Activity trail. Accessors are anonymous providers (not Rhodes users), so
-- there's no auth user id — only what they claimed plus request metadata.
CREATE TABLE provider_document_send_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  send_id UUID NOT NULL REFERENCES provider_document_sends(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('viewed','downloaded')),
  claimed_email TEXT,          -- what the recipient typed (UNVERIFIED)
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_send_access_send ON provider_document_send_access(send_id);
CREATE INDEX idx_send_access_org ON provider_document_send_access(organization_id);

ALTER TABLE provider_document_send_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON provider_document_send_access
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON provider_document_send_access
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON provider_document_send_access
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON provider_document_send_access
  FOR DELETE TO authenticated USING (true);
