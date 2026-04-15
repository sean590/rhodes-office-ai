-- Chat upload support: link document batches to chat sessions/messages
-- and store user-provided context for extraction

ALTER TABLE document_batches
  ADD COLUMN user_context TEXT,
  ADD COLUMN chat_session_id UUID,
  ADD COLUMN chat_message_id UUID;

-- Allow 'chat' as a batch context value
-- (existing CHECK constraint may need updating depending on how it's defined)
-- The context column uses: 'global' | 'entity' | 'onboarding' | 'chat'
