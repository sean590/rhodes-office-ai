-- Day 1 billing foundation: trial/subscription tracking on organizations + a
-- consent-records ledger for signup clickwrap and auto-renewal consent.
--
-- Model (single paid plan + 30-day trial): billing_plan holds the tier
-- ('free' | 'trial' | 'founding' ...), billing_status the Stripe lifecycle
-- ('active' | 'trialing' | 'past_due' | 'canceled'). New columns add the trial
-- clock, the Stripe price/period, and the cancel-at-period-end flag.

-- Trial clock. Trial extension is "yes, once, manual" (per go-live decisions) —
-- trial_extended guards the one-time grant.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_extended BOOLEAN NOT NULL DEFAULT false;

-- Subscription mirror (source of truth is Stripe; these are cached from webhooks).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_organizations_trial_ends_at
  ON organizations (trial_ends_at) WHERE trial_ends_at IS NOT NULL;

-- Consent ledger — one immutable row per consent event (signup clickwrap,
-- auto-renewal acknowledgment, AI-on-tax-docs disclosure). Records WHAT was
-- agreed (type + document version) and the proof-of-consent context (ip / ua).
-- NOTE: retained-on-deletion carve-out is a Day 6 (Workstream F) decision; for
-- now it's org-scoped and purges with the org.
CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  consent_type TEXT NOT NULL,
  document_version TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_org ON consent_records (organization_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_user ON consent_records (user_id);

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
-- Members can read their org's consent records; writes go through the service
-- role (signup / checkout paths), never client-side.
CREATE POLICY consent_records_read ON consent_records
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
