-- Inbound Increment 3 (rhodes-inbound-v1-ui-spec.md §1c/§3c/§3d + field findings).

-- Learned sender classifications: the "This is a delivery" teach action writes
-- kind='delivery' (triage then always treats the sender as delivery-ish);
-- "Not a provider" suppression writes kind='not_provider' (mutes discovery
-- suggestions for the domain).
CREATE TABLE IF NOT EXISTS inbound_delivery_senders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain          TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('delivery','not_provider')),
  learned_from    UUID REFERENCES inbound_deliveries(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, domain)
);
ALTER TABLE inbound_delivery_senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbound_delivery_senders_org_read ON inbound_delivery_senders
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids()));

-- 30-day skipped-mail purge nulls sender/subject down to the dedup stub.
ALTER TABLE inbound_deliveries ALTER COLUMN sender DROP NOT NULL;

-- Multi-link SafeSend threads: keep every candidate so retrieval can fall
-- back to the next link when one is expired/locked/wrong-recipient.
ALTER TABLE inbound_deliveries ADD COLUMN IF NOT EXISTS safesend_links TEXT[];
