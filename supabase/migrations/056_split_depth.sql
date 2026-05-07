-- 056_split_depth.sql
-- Pipeline unification: track recursion depth and parent context on split children.
-- See CLAUDE-CODE-PIPELINE-UNIFICATION.md for the full architecture.
--
-- split_depth caps recursive splitting (a tax package contains a K-1 bundle
-- contains per-investor K-1s). 0 = original upload, 1 = first-level split
-- child, 2 = deepest leaf we'll process. Splitter helper refuses to create
-- children when parent.split_depth >= 2.
--
-- split_context carries the parent's cover-page text, the user's chat context,
-- known investment_id, and known investor entity_ids forward to each child so
-- the per-section extraction has the same signal the parent had — without
-- this, a per-investor child sees only a sliver of pages and entity matching
-- collapses to ~50%.

ALTER TABLE document_queue
  ADD COLUMN split_depth INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN split_context JSONB DEFAULT NULL;

-- Lookup pattern: walk children of a given parent at a specific depth, or
-- enumerate all leaves under a parent. Partial index keeps the index small
-- since most queue items are roots (parent_queue_id IS NULL).
CREATE INDEX idx_document_queue_parent_split_depth
  ON document_queue(parent_queue_id, split_depth)
  WHERE parent_queue_id IS NOT NULL;
