-- 067 — Durable pipeline worker: per-item processing-attempt counter.
--
-- The cron worker (/api/cron/process-queue) claims `queued` items and reclaims
-- items stuck in `extracting` (orphaned when a function dies mid-run). Without
-- a cap, a doc that consistently dies mid-processing would be reclaimed and
-- re-run forever (a poison pill, burning tokens each time). This counter lets
-- the worker dead-letter such items to `error` after a few attempts.

ALTER TABLE document_queue
  ADD COLUMN IF NOT EXISTS process_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN document_queue.process_attempts IS
  'Times the durable worker has claimed this item for processing. Capped (MAX_ATTEMPTS) to dead-letter docs that die mid-run instead of looping forever.';
