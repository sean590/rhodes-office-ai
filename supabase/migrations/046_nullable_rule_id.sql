-- Migration 046: Allow compliance obligations without a predefined rule.
-- AI/user-created obligations (PTET, one-off filings, custom deadlines)
-- don't map to a rule_id. The existing UNIQUE(entity_id, rule_id, next_due_date)
-- handles nulls fine in Postgres (NULL != NULL), so ad-hoc obligations won't conflict.

ALTER TABLE compliance_obligations ALTER COLUMN rule_id DROP NOT NULL;

-- Track where the obligation came from.
ALTER TABLE compliance_obligations
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'rule';

COMMENT ON COLUMN compliance_obligations.source IS
  'Where this obligation came from: rule = rules engine, ai = created by Claude, user = manually created';

UPDATE compliance_obligations SET source = 'rule' WHERE rule_id IS NOT NULL;
