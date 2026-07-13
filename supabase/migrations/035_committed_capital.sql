-- Add committed capital tracking to investment_investors
-- Committed = total pledged amount; Called = sum of contribution transactions
ALTER TABLE investment_investors
  ADD COLUMN committed_capital DECIMAL(14,2) DEFAULT NULL;

COMMENT ON COLUMN investment_investors.committed_capital IS 'Total capital committed by this investor. Called capital is derived from contribution transactions.';
