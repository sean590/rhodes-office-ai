-- Entity-linked investments: when an investment IS one of our managed entities
-- (investments.entity_id set — a 1:1 link), the participants are the ENTITY's
-- cap-table members, not a separate investor list. A capital movement then
-- belongs to a specific cap-table member (which trust wired which contribution).
--
-- cap_table_entry_id is that attribution. Nullable + ON DELETE SET NULL:
--   - external-vehicle investments keep attributing via investment_investor_id,
--   - entity-linked investments attribute via cap_table_entry_id,
-- so a transaction carries exactly one of the two depending on the investment kind.
ALTER TABLE investment_transactions
  ADD COLUMN IF NOT EXISTS cap_table_entry_id UUID REFERENCES cap_table_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inv_txn_cap_entry
  ON investment_transactions (cap_table_entry_id)
  WHERE cap_table_entry_id IS NOT NULL;
