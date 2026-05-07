-- Migration 055: Enable RLS on person/joint-title tables.
-- These were missed in migration 037. Supabase security advisor flagged them
-- as publicly accessible (rls_disabled_in_public).

ALTER TABLE joint_title_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access to joint_title_members"
  ON joint_title_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users full access to person_relationships"
  ON person_relationships FOR ALL TO authenticated USING (true) WITH CHECK (true);
