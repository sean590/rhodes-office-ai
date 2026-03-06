-- ============================================================================
-- 013: Enable RLS on relationship_documents and user_profiles
--      + clean up duplicate waitlist policy
-- ============================================================================

-- 1. relationship_documents — junction table, no RLS at all
ALTER TABLE relationship_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select" ON relationship_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON relationship_documents
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON relationship_documents
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON relationship_documents
  FOR DELETE TO authenticated USING (true);

-- 2. user_profiles — no RLS at all
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select" ON user_profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON user_profiles
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON user_profiles
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete" ON user_profiles
  FOR DELETE TO authenticated USING (true);

-- 3. Clean up duplicate waitlist INSERT policy (added manually outside migrations)
DROP POLICY IF EXISTS "Anyone can join waitlist" ON waitlist;
