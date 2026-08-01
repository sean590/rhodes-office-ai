-- 083: First-class ownership transfer events.
--
-- Records an ownership stake moving from one internal entity to another on a
-- given investment — a gift, a sale, or "other" (e.g. an estate distribution).
-- Before this, the only way to reflect a transfer was to hand-edit the two
-- investors' percentages, which left no dated, valued, documented event behind.
--
-- Applying a transfer adjusts `investment_investors`:
--   * the FROM investor's capital_pct is reduced by `transferred_pct` (points of
--     the whole investment); its profit_pct and committed_capital move PRO-RATA
--     to the capital slice (fraction = transferred_pct / from.capital_pct_before)
--     so the economics travel with the stake.
--   * the TO investor gains the same capital points (+ the pro-rata profit /
--     committed); a new investor row is created if the recipient wasn't already
--     on the cap table.
-- `applied_snapshot` stores the before/after of both investor rows so the event
-- is auditable and, if we ever add it, reversible.
--
-- from/to entity ids are nullable with ON DELETE SET NULL, but we ALSO snapshot
-- the entity names (NOT NULL) — same fallback philosophy as allocation
-- member_name (082): deleting an entity must never blank out or block the
-- historical transfer record.

CREATE TABLE IF NOT EXISTS investment_ownership_transfers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investment_id     UUID NOT NULL REFERENCES investments(id)   ON DELETE CASCADE,

  from_entity_id    UUID REFERENCES entities(id) ON DELETE SET NULL,
  to_entity_id      UUID REFERENCES entities(id) ON DELETE SET NULL,
  -- Denormalized name snapshots so the record survives entity deletion.
  from_entity_name  TEXT NOT NULL,
  to_entity_name    TEXT NOT NULL,

  transfer_type     TEXT NOT NULL CHECK (transfer_type IN ('gift', 'sale', 'other')),
  -- Ownership percentage POINTS of the whole investment being moved.
  transferred_pct   NUMERIC NOT NULL CHECK (transferred_pct > 0 AND transferred_pct <= 100),
  -- Fair market value of the transferred stake at the transfer date.
  fair_market_value NUMERIC CHECK (fair_market_value IS NULL OR fair_market_value >= 0),
  -- Transferor's cost basis in the transferred stake (carryover basis for gifts).
  cost_basis        NUMERIC CHECK (cost_basis IS NULL OR cost_basis >= 0),
  transfer_date     DATE NOT NULL DEFAULT current_date,
  -- Supporting document (gift memo, assignment agreement, bill of sale).
  document_id       UUID REFERENCES documents(id) ON DELETE SET NULL,
  notes             TEXT,
  -- {from:{before,after}, to:{before,after}} investor rows at apply time.
  applied_snapshot  JSONB,

  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ownership_transfer_distinct_parties CHECK (
    from_entity_id IS NULL OR to_entity_id IS NULL OR from_entity_id <> to_entity_id
  )
);

CREATE INDEX IF NOT EXISTS idx_ownership_transfers_investment
  ON investment_ownership_transfers (investment_id, transfer_date DESC);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_org
  ON investment_ownership_transfers (organization_id);

ALTER TABLE investment_ownership_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON investment_ownership_transfers FOR ALL TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
