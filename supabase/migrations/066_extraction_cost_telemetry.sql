-- 066 — Document-agent cost telemetry
--
-- The pipeline already stored a single summed `extraction_tokens` (uncached
-- input + output), which is useless for cost: a cached read is ~0.1× and a
-- cache write ~1.25× of input. Break the usage out by billing class + record
-- turns, model, and a computed dollar cost, so we can build the real
-- cost-per-document distribution that gates pricing-tier decisions.

ALTER TABLE document_queue
  ADD COLUMN IF NOT EXISTS extraction_input_tokens          integer,
  ADD COLUMN IF NOT EXISTS extraction_output_tokens         integer,
  ADD COLUMN IF NOT EXISTS extraction_cache_read_tokens     integer,
  ADD COLUMN IF NOT EXISTS extraction_cache_creation_tokens integer,
  ADD COLUMN IF NOT EXISTS extraction_turns                 integer,
  ADD COLUMN IF NOT EXISTS extraction_model                 text,
  -- USD with sub-cent precision (a doc can cost fractions of a cent).
  ADD COLUMN IF NOT EXISTS extraction_cost_usd              numeric(12, 6);

COMMENT ON COLUMN document_queue.extraction_cache_creation_tokens IS
  'Cache *write* tokens. Rows with >0 paid the ~1.25x write (a "cold" prefix); used to measure how often the prompt cache is rebuilt vs reused.';
COMMENT ON COLUMN document_queue.extraction_cost_usd IS
  'Fully-loaded model cost of the agent run at the rate card in lib/pipeline/model-pricing.ts. 0/null = unknown model.';
