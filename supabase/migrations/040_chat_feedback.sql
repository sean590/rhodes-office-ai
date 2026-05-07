-- Migration 040: Thumbs+comment feedback on assistant chat messages.
--
-- Minimum-viable signal collection for tracking where the model fails before
-- Phase 2 write tools ship. Feedback is per (user, assistant-message): users
-- can update their rating (upsert, not insert). Comment is optional and only
-- surfaces in the UI on thumbs-down.
--
-- Role convention: Rhodes uses organization_members with an org_role enum
-- ('owner' | 'admin' | 'member' | 'viewer') — see migration 011. Owner-read
-- policy below mirrors that shape.

CREATE TABLE chat_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id)
);

CREATE INDEX idx_chat_feedback_message ON chat_feedback(message_id);
CREATE INDEX idx_chat_feedback_org_created ON chat_feedback(organization_id, created_at DESC);

ALTER TABLE chat_feedback ENABLE ROW LEVEL SECURITY;

-- Users read + write their own rows.
CREATE POLICY "users read own feedback" ON chat_feedback
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "users write own feedback" ON chat_feedback
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "users update own feedback" ON chat_feedback
  FOR UPDATE USING (user_id = auth.uid());

-- Org owners read all feedback in their org. Mirrors the org_role convention
-- from migration 011.
CREATE POLICY "owners read org feedback" ON chat_feedback
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- No updated_at trigger — Rhodes convention is for the application to set
-- updated_at on writes (no touch_updated_at / set_updated_at function lives
-- in the repo). The feedback POST endpoint writes updated_at = now() on
-- every upsert.
