-- Migration 043: Add status column to documents for early-creation flow.
--
-- Documents now get created at upload registration time with status 'processing',
-- then updated to 'ready' once pipeline extraction completes. Default is 'ready'
-- so all existing documents are unaffected.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';

COMMENT ON COLUMN documents.status IS
  'processing = created at upload, pipeline not done yet; ready = fully processed';

-- Also add metadata JSONB to document_batches for storing session_id and
-- other chat-context metadata on batches created via the chat drawer.
ALTER TABLE document_batches
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
