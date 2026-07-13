-- Migration 042: Tool-invocation audit table for MCP chat.
--
-- Per-tool-call grain: every read and write, success and failure, from every
-- orchestrator turn. Separate from chat_messages so message deletion doesn't
-- erase the audit trail. Write tools gain staged/applied_at/audit_log_id
-- columns so the approval flow lifecycle is fully observable.
--
-- Rhodes convention: organization_members table with org_role enum
-- ('owner' | 'admin' | 'member' | 'viewer'). RLS mirrors migration 040/041
-- (chat_feedback) shape.

CREATE TABLE chat_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  arg_keys TEXT[] NOT NULL DEFAULT '{}',
  kind TEXT NOT NULL CHECK (kind IN ('read', 'write')),
  ok BOOLEAN NOT NULL,
  error_code TEXT,
  error_message TEXT,
  duration_ms INTEGER NOT NULL,
  staged BOOLEAN NOT NULL DEFAULT false,
  applied_at TIMESTAMPTZ,
  audit_log_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_tool_calls_session ON chat_tool_calls(session_id, created_at DESC);
CREATE INDEX idx_chat_tool_calls_org_created ON chat_tool_calls(organization_id, created_at DESC);
CREATE INDEX idx_chat_tool_calls_tool_name ON chat_tool_calls(tool_name);

ALTER TABLE chat_tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own tool calls" ON chat_tool_calls
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "org owners read org tool calls" ON chat_tool_calls
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Writes go through admin client — no INSERT/UPDATE policy needed.
