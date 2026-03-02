-- 006_compliance_engine.sql
-- Compliance Rules Engine: legal_structure, compliance_obligations table, enum extensions

-- 1a. Add legal_structure enum + column to entities
CREATE TYPE legal_structure AS ENUM ('llc','corporation','lp','trust','gp','sole_prop','series_llc','other');
ALTER TABLE entities ADD COLUMN legal_structure legal_structure;

-- Backfill: trust entities get legal_structure = 'trust'
UPDATE entities SET legal_structure = 'trust' WHERE type = 'trust';

-- 1b. Extend filing_type enum with new values
ALTER TYPE filing_type ADD VALUE IF NOT EXISTS 'business_license';
ALTER TYPE filing_type ADD VALUE IF NOT EXISTS 'publication';
ALTER TYPE filing_type ADD VALUE IF NOT EXISTS 'registered_agent';
ALTER TYPE filing_type ADD VALUE IF NOT EXISTS 'estimated_fee';
ALTER TYPE filing_type ADD VALUE IF NOT EXISTS 'commerce_tax';
ALTER TYPE filing_type ADD VALUE IF NOT EXISTS 'information_report';
ALTER TYPE filing_type ADD VALUE IF NOT EXISTS 'decennial_report';
ALTER TYPE filing_type ADD VALUE IF NOT EXISTS 'business_entity_tax';
ALTER TYPE filing_type ADD VALUE IF NOT EXISTS 'statement_of_info';

-- 1c. Extend document_type enum
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'payment_confirmation';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'business_license_receipt';

-- 1d. Create compliance_obligations table (replaces unused entity_filings)
CREATE TABLE compliance_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  obligation_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL,

  -- Calculated due date for current/next cycle
  next_due_date DATE,

  -- Tracking
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  document_id UUID REFERENCES documents(id),
  payment_amount INTEGER,
  confirmation TEXT,
  notes TEXT,

  -- Metadata from rule
  fee_description TEXT,
  form_number TEXT,
  portal_url TEXT,
  filed_with TEXT,
  penalty_description TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(entity_id, rule_id, next_due_date)
);

CREATE INDEX idx_compliance_entity ON compliance_obligations(entity_id);
CREATE INDEX idx_compliance_status ON compliance_obligations(status);
CREATE INDEX idx_compliance_due_date ON compliance_obligations(next_due_date);
CREATE INDEX idx_compliance_rule ON compliance_obligations(rule_id);
CREATE INDEX idx_compliance_overdue ON compliance_obligations(status, next_due_date)
  WHERE status = 'pending';

-- 1e. RLS for compliance_obligations
ALTER TABLE compliance_obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select" ON compliance_obligations FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON compliance_obligations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON compliance_obligations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON compliance_obligations FOR DELETE TO authenticated USING (true);
