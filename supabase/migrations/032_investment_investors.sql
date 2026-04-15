-- Investment Investors: join table for multiple internal entities investing in a deal
-- See: rhodes-investments-v2-spec.md (investment_investors section)

-- ============================================================
-- 1. Create investment_investors table
-- ============================================================

CREATE TABLE investment_investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investment_id UUID NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  capital_pct DECIMAL(7,4),
  profit_pct DECIMAL(7,4),

  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  UNIQUE(investment_id, entity_id)
);

CREATE INDEX idx_inv_investors_investment ON investment_investors(investment_id) WHERE is_active = true;
CREATE INDEX idx_inv_investors_entity ON investment_investors(entity_id) WHERE is_active = true;

ALTER TABLE investment_investors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can access investment investors"
  ON investment_investors
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- 2. Migrate existing data: create investor rows from investments.parent_entity_id
-- ============================================================

INSERT INTO investment_investors (organization_id, investment_id, entity_id, capital_pct, profit_pct, created_by)
SELECT
  i.organization_id,
  i.id,
  i.parent_entity_id,
  i.capital_pct,
  i.profit_pct,
  i.created_by
FROM investments i
WHERE i.parent_entity_id IS NOT NULL;


-- ============================================================
-- 3. Alter investment_allocations: add investment_investor_id
-- ============================================================

ALTER TABLE investment_allocations
  ADD COLUMN investment_investor_id UUID REFERENCES investment_investors(id) ON DELETE CASCADE;

-- Populate from existing data: match via investment_id
UPDATE investment_allocations a
SET investment_investor_id = ii.id
FROM investment_investors ii
WHERE a.investment_id = ii.investment_id
  AND a.investment_investor_id IS NULL;

CREATE INDEX idx_alloc_investor_v2 ON investment_allocations(investment_investor_id) WHERE is_active = true;


-- ============================================================
-- 4. Alter investment_transactions: add investment_investor_id
-- ============================================================

ALTER TABLE investment_transactions
  ADD COLUMN investment_investor_id UUID REFERENCES investment_investors(id) ON DELETE CASCADE;

-- Populate from existing data: match via investment_id
UPDATE investment_transactions t
SET investment_investor_id = ii.id
FROM investment_investors ii
WHERE t.investment_id = ii.investment_id
  AND t.investment_investor_id IS NULL;

CREATE INDEX idx_txn_investor_v2 ON investment_transactions(investment_investor_id);


-- ============================================================
-- 5. Drop columns from investments that moved to investment_investors
-- ============================================================

ALTER TABLE investments
  DROP COLUMN IF EXISTS parent_entity_id,
  DROP COLUMN IF EXISTS capital_pct,
  DROP COLUMN IF EXISTS profit_pct;
