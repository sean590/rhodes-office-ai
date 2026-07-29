-- Inbound v1: mailbox-driven document intake (rhodes-inbound-v1-build-plan.md).
-- One row per triaged inbound email. The invariant this table upholds: every
-- delivery-looking message ends in a terminal state — ingested/retrieved
-- automatically, or needs_user (notification + email nudge), never silently
-- dropped. gmail_message_id UNIQUE makes the cron poll idempotent.

CREATE TABLE IF NOT EXISTS inbound_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL UNIQUE,
  gmail_thread_id  TEXT,
  sender           TEXT NOT NULL,
  subject          TEXT,
  received_at      TIMESTAMPTZ NOT NULL,
  -- What triage decided this message is:
  --   attachment  → ingestable files attached, sent to the pipeline
  --   safesend    → SafeSend-class secure link (auto-retrieval in Increment 2;
  --                 until then handled as needs_user)
  --   needs_user  → delivery Rhodes can't fetch (portal notification, MIP,
  --                 unknown secure link) → notification + email nudge
  --   ignored     → not a document delivery (newsletter, receipt, spam)
  classification   TEXT NOT NULL CHECK (classification IN ('attachment','safesend','needs_user','ignored')),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','ingested','retrieved','needs_user','resolved','dismissed','failed','ignored')),
  provider_id      UUID REFERENCES service_providers(id) ON DELETE SET NULL,
  batch_id         UUID REFERENCES document_batches(id) ON DELETE SET NULL,
  document_ids     UUID[] NOT NULL DEFAULT '{}',
  needs_user_reason TEXT,
  reminded_at      TIMESTAMPTZ,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_deliveries_org_status
  ON inbound_deliveries (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_inbound_deliveries_received
  ON inbound_deliveries (organization_id, received_at DESC);

-- Poll cursor: one row per org (v1 = single mailbox mapped to one org).
CREATE TABLE IF NOT EXISTS inbound_mail_state (
  organization_id  UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Gmail internalDate (ms epoch) of the newest message already triaged.
  last_internal_date BIGINT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: org-scoped reads for members (Home/needs-you surfaces); all writes go
-- through the service-role cron worker, so no authenticated write policies.
ALTER TABLE inbound_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_mail_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY inbound_deliveries_org_read ON inbound_deliveries
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY inbound_mail_state_org_read ON inbound_mail_state
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids()));
