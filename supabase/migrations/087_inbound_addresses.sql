-- 087: Hosted inbound addresses (multi-tenant Plan A).
--
-- Every org gets a unique hosted address `<local_part>@docs.rhodesoffice.ai`.
-- Mail sent there is received by AWS SES (us-west-2) → S3 → SNS → the
-- /api/inbound/ses webhook, which maps the recipient address back to the org
-- via this table and feeds attachments into the one ingestion pipeline. This
-- is the multi-tenant replacement for the single INBOUND_ORG_ID env used by the
-- Gmail-poll transport.

CREATE TABLE IF NOT EXISTS inbound_addresses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The token before the @ (lowercased). Globally unique with domain so the
  -- webhook can resolve recipient → org unambiguously.
  local_part      TEXT NOT NULL,
  domain          TEXT NOT NULL DEFAULT 'docs.rhodesoffice.ai',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inbound_addresses_local_part_lower CHECK (local_part = lower(local_part))
);

-- One address maps to exactly one org; the (local_part, domain) pair is the
-- routing key and must be globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_addresses_route
  ON inbound_addresses (local_part, domain);
CREATE INDEX IF NOT EXISTS idx_inbound_addresses_org
  ON inbound_addresses (organization_id) WHERE is_active;

ALTER TABLE inbound_addresses ENABLE ROW LEVEL SECURITY;

-- Members can read their own org's address (to display/share it). Writes come
-- from server code via the service-role client (provisioning), so no INSERT
-- policy for authenticated is needed.
CREATE POLICY inbound_addresses_org_read ON inbound_addresses FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids()));
