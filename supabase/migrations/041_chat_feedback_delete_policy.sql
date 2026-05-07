-- Migration 041: Allow users to delete their own chat_feedback rows.
--
-- Migration 040 enabled RLS on chat_feedback with SELECT/INSERT/UPDATE
-- policies but no DELETE policy. The admin client in POST /api/chat/feedback
-- bypasses RLS, so the POST path worked — but the new DELETE route (part of
-- the three-state toggle-clear UX) should be covered by an explicit policy
-- for defense-in-depth consistency with the other four policies on the table.

CREATE POLICY "users delete own feedback" ON chat_feedback
  FOR DELETE USING (user_id = auth.uid());
