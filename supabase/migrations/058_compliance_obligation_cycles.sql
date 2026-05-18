-- Compliance obligation cycles — audit history for completions.
--
-- The original model created a new compliance_obligations row for every
-- cycle, leaving the previous row in status=completed. That meant a single
-- conceptual obligation (e.g., CA Statement of Information) appeared as
-- multiple rows in the UI as cycles rolled forward, and there was no
-- centralized audit trail of "when has this been completed in the past"
-- when the in-place updates happened (the prior completion was overwritten).
--
-- New model: one row per ongoing obligation. The compliance_obligations
-- row carries the current state (next_due_date, last_completed_at). Each
-- time a cycle is completed, a row is appended to this table with the
-- (cycle_due_date, completed_at, completed_by, document_id, payment,
-- confirmation, notes) tuple, and the parent obligation's next_due_date
-- advances to the next cycle.
--
-- Backfill of existing duplicate rows is a separate migration so the data
-- consolidation can be reviewed independently.

CREATE TABLE compliance_obligation_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id UUID NOT NULL REFERENCES compliance_obligations(id) ON DELETE CASCADE,

  -- The due date this completion satisfied — captured at the time of
  -- completion so the historical record survives next_due_date advancing
  -- on the parent row.
  cycle_due_date DATE NOT NULL,

  completed_at TIMESTAMPTZ NOT NULL,
  completed_by UUID REFERENCES users(id),

  -- Linked filing artifact (e.g., the filed-Statement-of-Information PDF).
  document_id UUID REFERENCES documents(id),

  -- Optional payment + confirmation details, captured per cycle.
  payment_amount INTEGER,
  confirmation TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_obligation_cycles_obligation ON compliance_obligation_cycles(obligation_id);
CREATE INDEX idx_obligation_cycles_completed ON compliance_obligation_cycles(completed_at DESC);

ALTER TABLE compliance_obligation_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select" ON compliance_obligation_cycles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON compliance_obligation_cycles
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON compliance_obligation_cycles
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON compliance_obligation_cycles
  FOR DELETE TO authenticated USING (true);
