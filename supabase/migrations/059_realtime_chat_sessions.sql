-- chat_sessions wasn't in the supabase_realtime publication, so UPDATE
-- events on the table (which fire whenever a pipeline event or
-- batch_summary message lands in a session and bumps the session's
-- updated_at) weren't being pushed to subscribed clients. The chat-drawer
-- relies on these events to refresh the session list and surface unread
-- badges; without the publication, badges and ordering only updated when
-- something else triggered a manual session-list refetch.
--
-- chat_messages was already in the publication (verified via
-- pg_publication_tables); this migration just adds the missing sibling.

ALTER PUBLICATION supabase_realtime ADD TABLE chat_sessions;
