-- 057_review_chat_sessions.sql
-- Review/chat unification: link queue items that the document agent deferred
-- to the chat session that captures the agent's reasoning + the user's
-- pickers. /review reads from this linkage; "Open in chat" reuses the same
-- session. Same chat session is the source of truth across both surfaces.
--
-- See CLAUDE-CODE-REVIEW-UNIFICATION.md for the architecture (or recover
-- from chat history — phase 2 of the unification).

ALTER TABLE document_queue
  ADD COLUMN chat_session_id UUID DEFAULT NULL REFERENCES chat_sessions(id) ON DELETE SET NULL;

-- Lookup pattern: when /review renders a deferred item, it joins through
-- this column to read the agent's first message + staged actions. Most
-- queue items don't have a session (auto-ingested or errored), so partial.
CREATE INDEX idx_document_queue_chat_session
  ON document_queue(chat_session_id)
  WHERE chat_session_id IS NOT NULL;
