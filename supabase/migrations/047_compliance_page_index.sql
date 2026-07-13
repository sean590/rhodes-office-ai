-- Migration 047: Index for the compliance page's cross-entity queries.
-- The page queries compliance_obligations joined with entities, filtered
-- by entity_id + status + next_due_date. This composite index covers
-- the most common filter combinations.

CREATE INDEX IF NOT EXISTS idx_compliance_obligations_entity_status_date
  ON compliance_obligations(entity_id, status, next_due_date);
