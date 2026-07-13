-- Investment tracking: internal member allocations and contribution/distribution transactions
-- See: rhodes-investment-tracking-spec.md

-- ============================================================
-- investment_allocations
-- Tracks which members of a parent entity participate in a deal
-- entity, and at what internal percentage.
-- ============================================================

CREATE TABLE investment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The parent investment entity (e.g., RCM Investments LLC)
  parent_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- The deal entity (e.g., 3680 Colonial LLC)
  deal_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- The member getting the allocation (directory entry — a person or entity)
  member_directory_id UUID NOT NULL REFERENCES directory_entries(id) ON DELETE CASCADE,

  -- Their allocation percentage (internal to the parent entity)
  allocation_pct DECIMAL(7,4) NOT NULL,  -- e.g., 30.0000 = 30%

  -- Dollar amount committed (if known)
  committed_amount DECIMAL(14,2),

  -- When this allocation was set (for audit trail)
  effective_date DATE,

  -- Notes (e.g., "Joined in second close")
  notes TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,  -- false if member exited the deal
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  UNIQUE(parent_entity_id, deal_entity_id, member_directory_id)
);

-- Indexes
CREATE INDEX idx_alloc_member ON investment_allocations(member_directory_id) WHERE is_active = true;
CREATE INDEX idx_alloc_deal ON investment_allocations(deal_entity_id) WHERE is_active = true;
CREATE INDEX idx_alloc_org ON investment_allocations(organization_id);

-- RLS
ALTER TABLE investment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can access investment allocations"
  ON investment_allocations
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- investment_transactions
-- Tracks contributions into and distributions out of each deal,
-- per member.
-- ============================================================

CREATE TABLE investment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The parent investment entity (e.g., RCM Investments LLC)
  parent_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- The deal entity (e.g., 3680 Colonial LLC)
  deal_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- The member this transaction is for (null = entity-level transaction before split)
  member_directory_id UUID REFERENCES directory_entries(id) ON DELETE SET NULL,

  -- Transaction type
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('contribution', 'distribution', 'return_of_capital')),

  -- Amount (always positive; direction implied by transaction_type)
  amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),

  -- Date of the transaction
  transaction_date DATE NOT NULL,

  -- Optional: link to a document that evidences this transaction
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,

  -- Description / memo
  description TEXT,

  -- For distributions: link to the parent entity-level transaction
  parent_transaction_id UUID REFERENCES investment_transactions(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_txn_deal ON investment_transactions(deal_entity_id);
CREATE INDEX idx_txn_member ON investment_transactions(member_directory_id);
CREATE INDEX idx_txn_parent ON investment_transactions(parent_transaction_id);
CREATE INDEX idx_txn_org ON investment_transactions(organization_id);

-- RLS
ALTER TABLE investment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can access investment transactions"
  ON investment_transactions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
