-- Add 'password_required' to the queue_status enum.
--
-- The PR F (password-protected PDF handling) spec assumed document_queue.status
-- was a TEXT column. It's actually an enum (created in migration 007), so
-- adding a new status value requires an enum extension. The worker's catch
-- branch for PdfPasswordRequiredError tries to UPDATE status to
-- 'password_required'; without this enum value the UPDATE fails and locked
-- queue items get stuck in their prior status (typically 'extracting').
--
-- Mirrors migration 008's `ALTER TYPE queue_status ADD VALUE 'auto_ingested'`.

ALTER TYPE queue_status ADD VALUE IF NOT EXISTS 'password_required' AFTER 'error';
