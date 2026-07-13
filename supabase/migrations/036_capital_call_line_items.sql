-- ============================================================
-- 036_capital_call_line_items.sql
--
-- Adds JSONB line-item breakdowns and an adjustment-chain pointer to
-- investment_transactions. Supersedes the line-item portion of the
-- distribution waterfall work that was previously attempted via child rows
-- with extended transaction_type values — that approach was rejected by
-- the migration 027 transaction_type CHECK constraint and never worked in
-- production. There is no data to backfill: every prior child-row insert
-- bounced off the constraint. See rhodes-capital-call-line-items-spec.md
-- for the reconciliation rationale.
--
-- This migration is fully additive. It does NOT touch the transaction_type
-- CHECK constraint — the unified design keeps transaction_type at its
-- original three values ('contribution', 'distribution', 'return_of_capital')
-- and stores the breakdown in JSONB on the parent row.
-- ============================================================

-- 1. Line items column.
--
-- Shape:
--   [{ "category": "<enum>", "amount": <number>, "description": "<string|null>" }]
--
-- IMPORTANT — semantic asymmetry between contribution and distribution rows:
--   * Contributions:  sum(line_items.amount) == amount.
--                     Each entry is a positive dollar component (subscription,
--                     monitoring_fee, audit_tax_expense, etc.) and the sum
--                     equals the total cash out the door.
--   * Distributions:  gross_distribution.amount - sum(reduction lines) == amount.
--                     The parent `amount` is the NET delivered to the investor.
--                     `gross_distribution` is the headline number; every other
--                     category on the distribution side is a positive number
--                     that gets SUBTRACTED from gross to compute net.
--
-- The Zod schema in src/lib/validations.ts enforces both rules. We do not
-- duplicate them in a SQL constraint because validating JSONB sums in
-- Postgres is awkward and the check would just mirror the Zod rule.

ALTER TABLE investment_transactions
  ADD COLUMN line_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN investment_transactions.line_items IS
  'Breakdown of the transaction into categorized components. For contributions, sum equals amount. For distributions, gross_distribution minus reductions equals amount (parent amount is net delivered to the investor). See validations.ts.';

-- 2. Adjustment linkage.
--
-- An adjustment is a normal investment_transactions row whose
-- adjusts_transaction_id points back to the original. The amount on an
-- adjustment row may be negative (e.g., a $5,000 reduction to a capital
-- call is recorded as amount = -5000). The line_items array on an
-- adjustment may also contain negative numbers (e.g., a -$5,000
-- subscription line that reduces called capital).
--
-- We deliberately do NOT overload parent_transaction_id, which is already
-- used to link member-split child rows to their parent deal-level row.

ALTER TABLE investment_transactions
  ADD COLUMN adjusts_transaction_id UUID REFERENCES investment_transactions(id) ON DELETE SET NULL,
  ADD COLUMN adjustment_reason TEXT;

COMMENT ON COLUMN investment_transactions.adjusts_transaction_id IS
  'If set, this row is an amendment to the referenced transaction. Allows amount to be negative. Distinct from parent_transaction_id, which links member-split child rows.';

-- 3. Allow negative amounts on adjustment rows only.
--
-- Drop the existing check (created in migration 027 as
-- `amount DECIMAL(14,2) NOT NULL CHECK (amount > 0)`, so the auto-generated
-- constraint name is investment_transactions_amount_check) and re-add it
-- with the adjustment exception.

ALTER TABLE investment_transactions
  DROP CONSTRAINT investment_transactions_amount_check;

ALTER TABLE investment_transactions
  ADD CONSTRAINT investment_transactions_amount_check
  CHECK (
    (adjusts_transaction_id IS NULL AND amount > 0)
    OR (adjusts_transaction_id IS NOT NULL)
  );

-- 4. Index for adjustment-chain lookups.
--
-- Partial index because the vast majority of rows are NOT adjustments.

CREATE INDEX idx_investment_txns_adjusts
  ON investment_transactions(adjusts_transaction_id)
  WHERE adjusts_transaction_id IS NOT NULL;
