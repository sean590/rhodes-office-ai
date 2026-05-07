-- Migration 044: Enable Realtime on chat_messages.
--
-- The chat drawer subscribes to INSERT events on chat_messages for the active
-- session so pipeline completion notifications (and later: streaming responses,
-- background agent messages) arrive without polling.
--
-- RLS on chat_messages ensures users only receive rows from sessions in their
-- own organization.

ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
