-- Investments v2.1: Capital/profit split, co-investors join table, preferred return
-- See: rhodes-investments-v2-spec.md

-- ============================================================
-- 1. Replace ownership_pct with capital_pct / profit_pct
--    Add preferred return fields
-- ============================================================

ALTER TABLE investments
  ADD COLUMN capital_pct DECIMAL(7,4),
  ADD COLUMN profit_pct DECIMAL(7,4),
  ADD COLUMN preferred_return_pct DECIMAL(7,4),
  ADD COLUMN preferred_return_basis TEXT CHECK (preferred_return_basis IN ('capital_contributed', 'capital_committed'));

-- Migrate existing ownership_pct data into capital_pct (profit_pct left null for user to set)
UPDATE investments SET capital_pct = ownership_pct WHERE ownership_pct IS NOT NULL;

-- Drop the old column
ALTER TABLE investments DROP COLUMN IF EXISTS ownership_pct;


-- ============================================================
-- 2. Create investment_co_investors join table
-- ============================================================

CREATE TABLE investment_co_investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Link to directory entry (required)
  directory_entry_id UUID NOT NULL REFERENCES directory_entries(id),

  -- Role in the deal
  role TEXT NOT NULL DEFAULT 'co_investor' CHECK (role IN ('co_investor', 'promoter', 'operator', 'lender')),

  -- Capital and profit percentages (can differ)
  capital_pct DECIMAL(7,4),
  profit_pct DECIMAL(7,4),

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_coinvestor_investment ON investment_co_investors(investment_id);
CREATE INDEX idx_coinvestor_directory ON investment_co_investors(directory_entry_id);

-- RLS
ALTER TABLE investment_co_investors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can access investment co-investors"
  ON investment_co_investors
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- 3. Migrate existing co_investors JSONB data into the new table
--    Then drop the JSONB column
-- ============================================================

-- Migrate JSONB co-investors that have a directory_entry_id
INSERT INTO investment_co_investors (investment_id, organization_id, directory_entry_id, capital_pct, role)
SELECT
  i.id,
  i.organization_id,
  (co->>'directory_entry_id')::UUID,
  (co->>'ownership_pct')::DECIMAL(7,4),
  'co_investor'
FROM investments i,
     jsonb_array_elements(i.co_investors) AS co
WHERE co->>'directory_entry_id' IS NOT NULL
  AND co->>'directory_entry_id' != ''
  AND (co->>'directory_entry_id')::UUID IS NOT NULL;

-- Drop the JSONB column
ALTER TABLE investments DROP COLUMN IF EXISTS co_investors;
