-- 084: AI-generated investment overviews.
--
-- A genuine, model-written briefing per investment — "the SAFE converted at
-- $X in the seed round; two LPs remain uncalled…" — synthesized from the
-- investment's documents (their AI extractions), notes, transactions, ownership
-- transfers, and investors. Distinct from the templated one-liner the UI shows
-- today. Regenerated in the background when something material lands.
--
-- Trigger model: any material related write flips ai_overview_stale = true (via
-- the Postgres triggers below — one place, covering chat / API / ingestion). A
-- cron worker (cron/refresh-overviews) picks up stale rows and regenerates,
-- which also debounces a burst of uploads into a single regeneration.

ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS ai_overview                TEXT,
  ADD COLUMN IF NOT EXISTS ai_overview_generated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_overview_model          TEXT,
  -- Hash of the salient inputs at last generation — skip regenerating when
  -- nothing material actually changed (a stale flag can fire spuriously).
  ADD COLUMN IF NOT EXISTS ai_overview_fingerprint    TEXT,
  -- Default true so every existing investment regenerates on the first pass.
  ADD COLUMN IF NOT EXISTS ai_overview_stale          BOOLEAN NOT NULL DEFAULT true,
  -- Backoff / dead-letter for the worker.
  ADD COLUMN IF NOT EXISTS ai_overview_attempts       INT NOT NULL DEFAULT 0,
  -- Cost telemetry (4 token classes + USD), per the cost-instrumentation rule.
  ADD COLUMN IF NOT EXISTS ai_overview_cost_usd            NUMERIC,
  ADD COLUMN IF NOT EXISTS ai_overview_input_tokens        INT,
  ADD COLUMN IF NOT EXISTS ai_overview_output_tokens       INT,
  ADD COLUMN IF NOT EXISTS ai_overview_cache_read_tokens   INT,
  ADD COLUMN IF NOT EXISTS ai_overview_cache_creation_tokens INT;

-- Worker's claim query: stale rows that haven't exhausted their attempts.
CREATE INDEX IF NOT EXISTS idx_investments_overview_stale
  ON investments (ai_overview_stale, ai_overview_attempts)
  WHERE ai_overview_stale = true;

-- ── Staleness helper + triggers ──────────────────────────────────────────────
-- One SECURITY DEFINER helper; every trigger routes through it. The WHERE guard
-- makes re-marking an already-stale row a no-op (no trigger storm).
CREATE OR REPLACE FUNCTION mark_investment_overview_stale(inv UUID)
RETURNS void AS $$
BEGIN
  IF inv IS NOT NULL THEN
    UPDATE investments
      SET ai_overview_stale = true, ai_overview_attempts = 0
      WHERE id = inv AND ai_overview_stale = false;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- investment_investors → investment_id directly.
CREATE OR REPLACE FUNCTION trg_investor_overview_stale()
RETURNS trigger AS $$
BEGIN
  PERFORM mark_investment_overview_stale(COALESCE(NEW.investment_id, OLD.investment_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- investment_ownership_transfers → investment_id directly.
CREATE OR REPLACE FUNCTION trg_transfer_overview_stale()
RETURNS trigger AS $$
BEGIN
  PERFORM mark_investment_overview_stale(COALESCE(NEW.investment_id, OLD.investment_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- investment_transactions / investment_allocations → resolve via the investor.
CREATE OR REPLACE FUNCTION trg_investor_child_overview_stale()
RETURNS trigger AS $$
DECLARE inv UUID;
BEGIN
  SELECT investment_id INTO inv FROM investment_investors
    WHERE id = COALESCE(NEW.investment_investor_id, OLD.investment_investor_id);
  PERFORM mark_investment_overview_stale(inv);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- documents.investment_id (filing a doc to a deal, or moving it off) — mark
-- both the new and old investment.
CREATE OR REPLACE FUNCTION trg_document_overview_stale()
RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM mark_investment_overview_stale(NEW.investment_id);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM mark_investment_overview_stale(OLD.investment_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- note_links (attach/detach a note to an investment).
CREATE OR REPLACE FUNCTION trg_note_link_overview_stale()
RETURNS trigger AS $$
BEGIN
  PERFORM mark_investment_overview_stale(COALESCE(NEW.investment_id, OLD.investment_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- notes body/date edit → every investment the note is linked to.
CREATE OR REPLACE FUNCTION trg_note_overview_stale()
RETURNS trigger AS $$
BEGIN
  UPDATE investments SET ai_overview_stale = true, ai_overview_attempts = 0
    WHERE ai_overview_stale = false
      AND id IN (SELECT investment_id FROM note_links WHERE note_id = NEW.id AND investment_id IS NOT NULL);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS investor_overview_stale ON investment_investors;
CREATE TRIGGER investor_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON investment_investors
  FOR EACH ROW EXECUTE FUNCTION trg_investor_overview_stale();

DROP TRIGGER IF EXISTS transfer_overview_stale ON investment_ownership_transfers;
CREATE TRIGGER transfer_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON investment_ownership_transfers
  FOR EACH ROW EXECUTE FUNCTION trg_transfer_overview_stale();

DROP TRIGGER IF EXISTS txn_overview_stale ON investment_transactions;
CREATE TRIGGER txn_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON investment_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_investor_child_overview_stale();

DROP TRIGGER IF EXISTS alloc_overview_stale ON investment_allocations;
CREATE TRIGGER alloc_overview_stale
  AFTER INSERT OR UPDATE OR DELETE ON investment_allocations
  FOR EACH ROW EXECUTE FUNCTION trg_investor_child_overview_stale();

DROP TRIGGER IF EXISTS document_overview_stale ON documents;
CREATE TRIGGER document_overview_stale
  AFTER INSERT OR UPDATE OF investment_id OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION trg_document_overview_stale();

DROP TRIGGER IF EXISTS note_link_overview_stale ON note_links;
CREATE TRIGGER note_link_overview_stale
  AFTER INSERT OR DELETE ON note_links
  FOR EACH ROW EXECUTE FUNCTION trg_note_link_overview_stale();

DROP TRIGGER IF EXISTS note_overview_stale ON notes;
CREATE TRIGGER note_overview_stale
  AFTER UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION trg_note_overview_stale();
