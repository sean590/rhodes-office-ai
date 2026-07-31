-- 080: Inbound channels — the multi-tenancy backbone (rhodes-inbound-
-- multitenancy-plan.md). One row per org describing HOW inbound mail reaches
-- it. Both product plans feed the SAME triage → ingest → SafeSend pipeline:
--   'rhodes_hosted'    Plan A — a unique unguessable address on our domain
--                      (in.rhodesoffice.ai), received via an inbound email
--                      service webhook (push; no credentials).
--   'google_oauth'     Plan B — a customer's dedicated mailbox connected via
--   'microsoft_oauth'  OAuth (read via API). Gated to an org allowlist until
--                      external Google/Microsoft verification is done.
--
-- Replaces the single-tenant INBOUND_ORG_ID env constant. The existing prod
-- mailbox (Rhodes@channels.com via env creds) becomes one google_oauth row
-- with credentials_ref='env' — the worker auto-seeds it, so nothing breaks.

CREATE TABLE IF NOT EXISTS inbound_channels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('rhodes_hosted','google_oauth','microsoft_oauth')),
  -- Inbound address: hosted → generated @in.rhodesoffice.ai; oauth → the
  -- connected mailbox address (what the poll reads).
  address          TEXT,
  -- Hosted routing key: the unguessable local-part token that resolves an
  -- incoming recipient address back to this org. NULL for oauth (per-conn).
  recipient_token  TEXT UNIQUE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','revoked','error')),
  label            TEXT,
  -- How to obtain read credentials for a poll channel: 'env' = the legacy
  -- single mailbox via GMAIL_* env vars; a secrets reference later. NULL for
  -- hosted (push, no creds to store).
  credentials_ref  TEXT,
  connected_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at     TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One channel per (org, type, address) — makes the legacy-channel auto-seed
-- idempotent and prevents duplicate connections of the same mailbox.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_channels_org_type_address
  ON inbound_channels (organization_id, type, address) WHERE address IS NOT NULL;

-- Poll sweep looks up active oauth channels quickly.
CREATE INDEX IF NOT EXISTS idx_inbound_channels_active_poll
  ON inbound_channels (status, type) WHERE status = 'active';

ALTER TABLE inbound_channels ENABLE ROW LEVEL SECURITY;
-- Org members may read their own channels (Settings → Mailbox). Writes are
-- service-role only (connect flow / worker auto-seed).
CREATE POLICY inbound_channels_org_read ON inbound_channels
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids()));
