-- Investments v2: External investments as first-class objects
-- See: rhodes-investments-v2-spec.md

-- ============================================================
-- investments
-- The central record for every external deal. Lightweight by design.
-- ============================================================

CREATE TABLE investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The internal entity making the investment (e.g., RCM Investments LLC)
  parent_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- Investment identity
  name TEXT NOT NULL,
  short_name TEXT,
  investment_type TEXT NOT NULL CHECK (investment_type IN ('real_estate', 'startup', 'fund', 'private_equity', 'debt', 'other')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exited', 'winding_down', 'committed', 'defaulted')),

  -- Optional link to an internal entity (hybrid case)
  entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,

  -- Lightweight metadata
  description TEXT,
  formation_state TEXT,
  date_invested DATE,
  date_exited DATE,

  -- Ownership percentage of the parent entity in this deal
  ownership_pct DECIMAL(7,4),

  -- Co-investors stored as JSONB array
  -- Format: [{ "name": "Partner X", "ownership_pct": 40.0, "directory_entry_id": "uuid-or-null" }]
  co_investors JSONB NOT NULL DEFAULT '[]',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_investments_org ON investments(organization_id);
CREATE INDEX idx_investments_parent ON investments(parent_entity_id);
CREATE INDEX idx_investments_entity ON investments(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX idx_investments_status ON investments(organization_id, status) WHERE status = 'active';

-- RLS
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can access investments"
  ON investments
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- Modify investment_allocations to support investment_id
-- ============================================================

-- Add investment_id column
ALTER TABLE investment_allocations
  ADD COLUMN investment_id UUID REFERENCES investments(id) ON DELETE CASCADE;

-- Make old entity references nullable (for new investment-based records)
ALTER TABLE investment_allocations
  ALTER COLUMN parent_entity_id DROP NOT NULL,
  ALTER COLUMN deal_entity_id DROP NOT NULL;

-- Drop old unique constraint and add new one
ALTER TABLE investment_allocations
  DROP CONSTRAINT IF EXISTS investment_allocations_parent_entity_id_deal_entity_id_memb_key;

CREATE UNIQUE INDEX idx_alloc_investment_member
  ON investment_allocations(investment_id, member_directory_id)
  WHERE investment_id IS NOT NULL AND is_active = true;

CREATE INDEX idx_alloc_investment ON investment_allocations(investment_id) WHERE is_active = true;


-- ============================================================
-- Modify investment_transactions to support investment_id
-- ============================================================

ALTER TABLE investment_transactions
  ADD COLUMN investment_id UUID REFERENCES investments(id) ON DELETE CASCADE;

ALTER TABLE investment_transactions
  ALTER COLUMN parent_entity_id DROP NOT NULL,
  ALTER COLUMN deal_entity_id DROP NOT NULL;

CREATE INDEX idx_txn_investment ON investment_transactions(investment_id);


-- ============================================================
-- Add investment_id to documents
-- ============================================================

ALTER TABLE documents
  ADD COLUMN investment_id UUID REFERENCES investments(id) ON DELETE SET NULL;

CREATE INDEX idx_documents_investment ON documents(investment_id) WHERE investment_id IS NOT NULL;


-- ============================================================
-- Add investment_id to audit_log for activity queries
-- ============================================================

ALTER TABLE audit_log
  ADD COLUMN investment_id UUID;

CREATE INDEX idx_audit_investment ON audit_log(investment_id, created_at DESC) WHERE investment_id IS NOT NULL;
